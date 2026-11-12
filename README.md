# 养殖场水质监测平台 · 前端

Vue 3 + Vite + TypeScript + ECharts 大屏，包含五页车间平面、池位与检测机选择、五项水质读数、告警和历史曲线。

默认使用可独立运行的**模拟数据**。前端已实现后端接口模式；仓库不包含现场后端，当前配置和示例数据不能证明已接入真实设备。

## 本地运行

安装 **Node.js 22.18 及以上**和随附的 npm。测试直接加载 TypeScript 源文件，因此本项目要求比 Vite 最低版本更高的 Node.js 版本。

```bash
git clone https://github.com/Xiaokk12/aquaculture-dashboard.git
cd aquaculture-dashboard
npm ci
npm run dev
```

私有仓库需先取得访问权限；也可解压源码包后，在包含 `package.json` 的目录执行后两条命令。打开 <http://localhost:8112/#/index>，端口占用时以终端输出为准。

## 对接后端

复制配置：

```bash
cp .env.example .env.development.local
```

内容如下，修改后重启开发服务器：

```dotenv
VITE_DATA_SOURCE=api
VITE_API_BASE_URL=/api
API_PROXY_TARGET=http://localhost:8080
```

前端每 30 秒读取当前车间快照，历史曲线按选中池位、参数和时段请求。接口失败会明确提示，并可重试；接口模式不会自动换成模拟值。开发时 Vite 将 `/api` 原样转发给后端；跨电脑联调时将 `API_PROXY_TARGET` 改为后端电脑地址。

接口约定见 [接口文档.md](接口文档.md)，启动、部署和排错见 [运行说明.md](运行说明.md)。本地配置 `*.local` 不提交到 Git；`VITE_` 开头的变量会写入前端，不能放密钥。

## 检查与构建

```bash
npm test
npm run type-check
npm run build
npm run preview
```

构建结果在 `dist/`。构建默认也是模拟模式；正式接后端时先在 `.env.production.local` 设置 `VITE_DATA_SOURCE=api`、`VITE_API_BASE_URL=/api`，再重新构建，并由 Nginx 等服务器转发 `/api`。`npm run preview` 仅用于本地检查静态构建结果，不配置后端代理。

## 代码与协作

| 路径 | 作用 |
| --- | --- |
| `src/views/index/index.vue` | 大屏页面、车间切换与 30 秒轮询 |
| `src/features/aquaculture/workshops.ts` | 图纸中的车间、池位、检测机与平面坐标 |
| `src/features/aquaculture/api.ts` | 模拟／接口切换、HTTP 请求、响应校验与布局合并 |
| `src/features/aquaculture/data.ts` | 数据类型、演示数据、状态与告警计算 |
| `src/features/aquaculture/HistoryChart.vue` | 异步历史曲线与加载／失败提示 |
| `src/features/aquaculture/README.md` | 图纸来源、数据与状态边界 |

五页前端配置共有 13 个检测机编号和 281 条池位记录。贝类育苗图仅画单栋，三栋的实际编号仍待确认，不能据此认定全场只有 281 个池。当前阈值、过期时间和单位仍需现场确认，接口模式也沿用这些展示配置。

仓库拥有者可在 GitHub 的 **Settings → Collaborators** 中添加后端同学。协作时先更新，再提交各自修改：

```bash
git switch main
git pull --ff-only
# 修改并检查代码
npm test
npm run type-check
npm run build
git add <本次修改的文件>
git commit -m "说明本次修改"
git push origin main
```

如需同时开发同一文件，先建立分支再通过 Pull Request 合并，避免互相覆盖。不要提交 `node_modules/`、`dist/`、个人本地配置或凭据。

## 原始模板

基于 [daidaibg/IofTV-Screen-Vue3](https://github.com/daidaibg/IofTV-Screen-Vue3) 修改。原始说明保存在 [docs/README-template.md](docs/README-template.md)，原 [LICENSE](LICENSE) 保留。原模板的地图、接口和展示说明不等于本养殖场页面当前功能。
