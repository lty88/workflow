# 活动流程 ERP

公司内部活动的轻量协同系统，覆盖申请、动态审批、执行、成果归档和配置中心。PC 管理端与移动 H5 使用同一套 Vue 页面、真实接口和 MySQL 数据。

**项目工作区：`/Users/codesun/qh_workspace/work-flow`。** 后续需求放在 `docs/`，原型放在 `prototype/`，正式代码放在 `apps/` 和 `packages/`。

## 已实现

- 活动工单：分步动态表单、草稿、费用自动合计、条件显隐、校验定位、附件、真实路线预览、退回补充和重新提交。
- 流程引擎：串行、并行汇合、金额条件、角色全员会签、前加签、后加签、并行新增审批／任务／知会、个人待办转交、禁止自审。
- 批准后闭环：指派、到时开始、实际执行汇报、成果提交、档案审核／退回、取消申请／审核／撤销、关闭工单复制新申请。
- 配置中心：动态表单、节点依赖、组织架构与成员、角色权限和数据范围、菜单分组及动态页面；草案保存、版本冲突、校验发布。
- AntV G6 图交互：组织架构、审批模板、路线演算和实际审批进度统一绘图；节点点击联动编辑或待办，支持定位、缩放、平移、状态与历史轮次。
- 账号与权限：服务端会话、HttpOnly Cookie、CSRF、限流、密码修改／重置；接口再次检查权限、数据范围和当前节点资格。
- 追溯与通知：申请快照、操作审计、主单／任务／流程结构独立版本、幂等请求、事务发件箱、站内消息、审批待办 24h 提醒与 48h 升级。
- 受控导出：单工单和当前筛选列表 CSV，记录操作者审计，列表单次最多 2000 条。

菜单绑定已实现的业务模板。当前是一家公司、一套活动申请表和一套可配置活动审批模板；执行及归档阶段使用明确的业务状态机。

## 技术栈

| 层级 | 版本与选择 |
| --- | --- |
| 前端 | Vue 3.5.44、Naive UI 2.45.3、Vite 8.3.4、Pinia 4.1.0、Vue Router 5.4.0 文件路由、VueUse 15 |
| 图引擎 | AntV G6 5.1.1，Dagre 分层布局，运行时懒加载 |
| 服务端 | Node.js 24+、Fastify 5.12.7、mysql2 3.24.6、Zod 4.6.7 |
| 数据库 | MySQL 8.4，Compose 默认仅映射本机 3307 |
| 类型 | 服务端与共享业务使用 TypeScript 7.0.2；Vue 使用兼容的 `@typescript/typescript6@6.0.2` 别名及 vue-tsc 3.3.13 |
| 工程 | pnpm 11.21.0 workspace、Vitest 5.0.5、Prettier 3.9.10 |

Vue 类型工具当前依赖 TypeScript 的 JS 编译器 API，因此前端固定使用兼容的 TypeScript 6；参考 [Vue Language Tools 官方说明](https://github.com/vuejs/language-tools/issues/6124)。路由按 [Vue Router 文件路由规则](https://router.vuejs.org/file-based-routing/)从 `src/pages/` 自动生成。

## 目录

```text
apps/web/                 Vue 页面、模块组件、会话与配置 store、接口封装
apps/server/src/          HTTP 接口、业务服务、MySQL 仓储、初始化和局部测试
packages/domain/src/     共享类型、表单校验、权限、流程与业务状态机
docs/                    PRD、流程设计、实施说明、接口与校验记录
prototype/               历史可点击 HTML 原型
compose.yaml             MySQL 容器及持久化卷
.env.example             数据库、会话和初始账号配置示例
AGENTS.md                本项目开发规则
```

## 本机 MySQL 启动（当前推荐）

本机已有 3306 MySQL 服务，可以直接使用。先在当前运行 `pnpm dev` 的终端按 Ctrl+C，再运行配置向导：

```sh
cd /Users/codesun/qh_workspace/work-flow
nvm use
pnpm db:setup
```

管理账号默认 `root`；提示密码时，输入你已有的 **MySQL 管理员密码**，输入不会回显。向导将创建独立项目数据库和仅用于本项目的随机账号，验证连接后保存 `.env`。已有有效配置直接复用；已有业务数据时要求恢复原连接配置，不重置数据或登录密码。

向导会自动生成 `ADMIN_PASSWORD` 和示例员工 `SEED_USER_PASSWORD`，保存在本地 `.env`，已有真实值保持不变。MySQL 管理员密码只用于此次配置，不保存到文件。原 `.env` 备份为 `.env.<时间>.local`。

看到“本机数据库连接成功”后，再执行以下命令。初始化失败时，`&&` 会阻止继续启动。

```sh
pnpm db:init && pnpm dev
```

数据库中的 `root` 密码与本应用登录的 `admin` 密码是两个独立凭据。管理员登录使用 `.env` 的 `ADMIN_PASSWORD`。不要重复执行 `cp .env.example .env`，这会覆盖已配置的密码。

## Docker MySQL 方案（可选）

此方案需要电脑已有可用的 Docker 命令。没有 Docker 时使用上面的本机方案即可。

首次配置时运行以下命令；已有 `.env` 会保留。

```sh
cd /Users/codesun/qh_workspace/work-flow
nvm use
cp -n .env.example .env
```

然后单独编辑 `.env`：容器端口使用 `MYSQL_PORT=3307`，数据库账号使用 `MYSQL_USER=workflow`，填写 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD` 和至少12位且非占位值的 `ADMIN_PASSWORD`。需要示例员工登录时填写 `SEED_USER_PASSWORD`。

完成编辑后再运行：

```sh
docker compose up -d mysql
docker compose ps
```

确认容器健康后初始化并启动：

```sh
pnpm db:init && pnpm dev
```

交互式 zsh 可能将单独粘贴的 `#` 注释行当命令，因此操作步骤写在代码块外。任一步报错先处理该步，避免跳过初始化继续启动。

前端入口：`http://localhost:5173`；服务端：`http://127.0.0.1:3100`。前端通过同源 `/api` 代理连接服务端。开发入口和 `.env` 的 `APP_ORIGIN` 保持一致；前端端口占用时会直接报错，避免静默换端口造成来源校验失败。

`db:init` 显式创建表并写入首版配置；数据库已有配置时保留现有配置和密码。以后结构演进应追加版本化迁移，勿依赖 `CREATE TABLE IF NOT EXISTS` 自动修改既有列。

初始管理员账号为 **admin**，密码取 `.env` 的 `ADMIN_PASSWORD`。管理员默认仅有配置权限。发布成员和角色后，可以在组织架构中设置员工密码；密码修改会撤销该成员全部旧会话。

| 试用账号 | 姓名 | 初始职责 |
| --- | --- | --- |
| linxiao / qiaoan | 林晓 / 乔安 | 教研一部／二部申请人 |
| chenning / duyun | 陈宁 / 杜云 | 各部门初审 |
| zhoulan | 周岚 | 教研审核 |
| zhaoming | 赵明 | 营销审核 |
| liuwen | 刘文 | 高预算复核 |
| wangzhou | 王舟 | 研究院流程协调、加签和指派 |
| suhe | 苏禾 | 执行与汇报 |
| heqing | 何青 | 研究院档案审核 |

示例员工密码仅在初始化时设置了 `SEED_USER_PASSWORD` 才会开通，也可由管理员逐个设置。

## 检查与部署

```sh
pnpm typecheck
pnpm test
pnpm format:check
```

部署时使用 HTTPS 和同域反向代理：静态页面启用 history 路由回退，将 `/api` 转发给服务端；设置 `NODE_ENV=production`、实际域名的 `APP_ORIGIN`，持久化 MySQL 卷和上传目录。服务端生产入口为 `pnpm --filter @workflow/server start`，前端产物由 Vite 生成后交给静态服务。

本轮完成了静态检查和局部校验，真实 MySQL 事务、容器初始化及两端浏览器操作待环境启动后联调。具体实施口径见 [实施说明](docs/前后端实施说明.md)、[G6 图交互说明](docs/G6图交互说明.md)、[接口说明](docs/API接口说明.md) 和 [本轮校验记录](docs/前后端校验记录.md)。
