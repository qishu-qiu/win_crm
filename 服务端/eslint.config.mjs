// =============================================================================
// ESLint 扁平配置（flat config）
//
// ★ linter 依赖只有 `eslint@10.10.0` ＋ `typescript-eslint@8.70.0`（peer 兼容已实测）；
//   **不 import `@eslint/js` / `globals` / `eslint-plugin-prettier` / `eslint-plugin-import`**
//   —— 这些都没装，引了就是「未声明依赖」（现在能跑只因 node_modules 扁平化，换个安装方式就炸）。
//
// ★ 模块边界硬卡（架构说明 §5.4 表格 **8 条**）＝ M0-40 ~ M0-44 ＋ M0-44b（kernel 禁 modules）
//   ＋ M0-44c（域**禁 shared**、只许引 kernel —— 横切层靠全局注册生效，见 §7.1）
//   ＋ M0-44d（kernel 禁 shared —— `shared` 依赖 `kernel`，反向引即**成环**）。
//   手段＝ `typescript-eslint` **内置**的 `no-restricted-imports`（**零新依赖**，正是规格指定手段）。
//   白名单语义（"只许 import 谁" ＋ "仅本域可引仓储"）用「按域生成配置块」表达：
//   flat config 中同一文件命中多个块时**后者覆盖前者**（不是合并），故每个域只生成一个块，
//   且 `domain/**` 的块必须排在域块**之后**（它要**重复带上**域边界规则，否则会把域规则覆盖掉）。
//
// ★ 边界规则只做**文本路径匹配**，不解析模块是否真实存在 —— 与 tsc / 运行时无关。
//   `npm run lint` 失败＝提交不上去（架构 §5.4「靠工具，不靠自觉」）。
//
// ★ 每条规则的负向自检见 M0-45：故意越界一次 → 必须报错 → 立即回滚；**负向不报错＝等于没卡**。
// =============================================================================
import tseslint from 'typescript-eslint';

// -----------------------------------------------------------------------------
// 模块边界常量表（照抄 架构说明 §5.1 依赖分层；将来调层级只改这里一处）
//   第 1 层 org(A) ＜ 第 2 层 company(B) ＜ 第 3 层 relation(C) ＜ 第 4 层 engine/trade/sea/approval(D~G)
// -----------------------------------------------------------------------------
const LAYER = { org: 1, company: 2, relation: 3, engine: 4, trade: 4, sea: 4, approval: 4 };
const DOMAINS = Object.keys(LAYER);

/** 本域允许 import 的域：层级**严格更低**（§5.1 硬规则 1） */
const allowedBy = (d) => DOMAINS.filter((x) => x !== d && LAYER[x] < LAYER[d]);
/** 本域禁止 import 的域：层级**更高或同层**（§5.1 硬规则 1 ＋ 硬规则 2） */
const forbiddenBy = (d) => DOMAINS.filter((x) => x !== d && LAYER[x] >= LAYER[d]);

/** 整域禁止：跨域直连（跨域只许走对方 service 或领域事件，§5.2） */
const crossDomainPatterns = (d) =>
  forbiddenBy(d).map((x) => ({
    group: [`**/${x}/**`],
    message: `跨域直连被拦（架构 §5.4）：模块「${d}」不得 import 模块「${x}」。需要协作请走对方 service（§5.2）或发领域事件。`,
  }));

/** 允许层里也只许调 service：不许直连对方 repository（§5.4 第 5 行） */
const crossRepoPatterns = (d) =>
  allowedBy(d).map((x) => ({
    group: [`**/${x}/**/*.repository`],
    message: `跨域直连仓储被拦（架构 §5.4）：模块「${d}」不得 import 模块「${x}」的 repository，请走其 exports 出来的 service。`,
  }));

/** domain 层是纯业务逻辑：不许依赖框架 / ORM（§5.4 第 6 行） */
const DOMAIN_LAYER_PATTERNS = [
  {
    group: ['@nestjs/*'],
    message: 'domain 层须与框架解耦（架构 §5.4）：`domain/**` 不得 import `@nestjs/*`。',
  },
  {
    group: ['@prisma/client'],
    message: 'domain 层须与 ORM 解耦（架构 §5.4）：`domain/**` 不得 import `@prisma/client`。',
  },
];

/** 域只许引 kernel：横切层靠全局注册生效，不得直连 shared（§5.4 表格 ＋ §7.1） */
const SHARED_PATTERNS = [
  {
    group: ['**/shared/**'],
    message:
      '横切层不可直连（架构 §5.4）：业务域不得 import `shared/**`。鉴权 / 数据范围 / 脱敏 / 异常 / 校验由 `APP_GUARD`、`APP_INTERCEPTOR`、`APP_FILTER`、`APP_PIPE` **全局生效**，域不必也不许自己引；域需要的通用能力（上下文 / 错误 / 事件 / 审计）请从 `kernel` 引（§7.1 的「A 域也能用同一套横切」指**运行时**生效，非代码 import）。',
  },
];

const boundaryPatterns = (d) => [
  ...crossDomainPatterns(d),
  ...crossRepoPatterns(d),
  ...SHARED_PATTERNS,
];

// 每个域一个块 —— 同一文件只命中一个块，避免 flat config「后者覆盖前者」把规则吃掉
const domainBlocks = DOMAINS.map((d) => ({
  files: [`src/modules/${d}/**/*.ts`],
  rules: {
    'no-restricted-imports': ['error', { patterns: boundaryPatterns(d) }],
  },
}));

// domain 层块 —— 必须排在域块**之后**，并**重复带上域边界规则**（否则覆盖掉上面的块）
const domainLayerBlocks = DOMAINS.map((d) => ({
  files: [`src/modules/${d}/domain/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...boundaryPatterns(d), ...DOMAIN_LAYER_PATTERNS] },
    ],
  },
}));

/** 内核零业务依赖（§5.1 硬规则 3 ＋ §5.4 第 1 行） */
const kernelBlock = {
  files: ['src/kernel/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/modules/**'],
            message:
              '内核零业务依赖被拦（架构 §5.4）：`kernel/**` 不得 import `modules/*`，业务规矩不准下沉进内核。',
          },
          {
            group: ['**/shared/**'],
            message:
              '内核不得反向依赖横切层（架构 §5.4 首行）：`shared/**` 依赖 `kernel`（守卫要 `ContextService`、装配要 `ContextModule`），`kernel` 再引 `shared` 即**成环**。「内核需要 shared」不存在正当场景 —— 横切层用的通用能力（上下文 / 错误 / 事件 / 审计）本就在 `kernel` 内，缺什么加什么，不要反向引。',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    // 不参与 lint：构建产物 / 依赖 / Prisma 生成物 / 覆盖率产物
    // （src/generated 已被根 .gitignore 忽略 —— 它是 `prisma generate` 的产物，随 schema 可再生）
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      // NestJS 全程 CJS（tsconfig `module: commonjs`），显式声明避免把 require / module.exports 误判
      sourceType: 'commonjs',
    },
  },
  kernelBlock,
  ...domainBlocks,
  ...domainLayerBlocks,
);
