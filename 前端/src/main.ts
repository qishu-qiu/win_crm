import Antd from 'ant-design-vue'
import { createApp } from 'vue'

// 样式登记顺序（后引用的覆盖先引用的）：
//   ① AntD reset（组件基线）→ ② 设计 token（§二 数值唯一事实源）→ ③ 本项目全局最小样式
import 'ant-design-vue/dist/reset.css'
import './styles/tokens.css'
import './style.css'

import App from './App.vue'
import router from './router'

createApp(App).use(Antd).use(router).mount('#app')
