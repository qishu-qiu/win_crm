import { BusinessRelationService } from './business-relation.service.js';
import { InMemoryBusinessRelationRepository } from './business-relation.repository.js';
import { ActivateRelationDto } from './business-relation.dto.js';

describe('BusinessRelationService.activate —— 铁律：唯一性兜底', () => {
  let repo: InMemoryBusinessRelationRepository;
  let svc: BusinessRelationService;

  beforeEach(() => {
    repo = new InMemoryBusinessRelationRepository();
    svc = new BusinessRelationService(repo);
  });

  const baseDto = (): ActivateRelationDto => ({
    companyId: 'c1',
    departmentId: 'd1',
    productLineId: 'p1',
    ownerId: 'uA',
    ownerName: '销售A',
  });

  it('首次激活成功并锁定主对接销售', async () => {
    const r = await svc.activate(baseDto());
    expect(r.ownerId).toBe('uA');
    expect(r.status).toBe('intention');
  });

  it('同组合二次激活返回 409 且带归属人（撞单，不静默建重复）', async () => {
    await svc.activate(baseDto());
    await expect(svc.activate(baseDto())).rejects.toMatchObject({
      response: { owner: { id: 'uA', name: '销售A' } },
    });
  });

  it('不同部门同产品线允许并行（不撞单）', async () => {
    await svc.activate(baseDto());
    const r2 = await svc.activate({
      ...baseDto(),
      departmentId: 'd2',
      ownerId: 'uB',
      ownerName: '销售B',
    });
    expect(r2.ownerId).toBe('uB');
  });
});
