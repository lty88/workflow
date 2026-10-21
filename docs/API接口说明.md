# API 接口说明 V0.4

基础路径 `/api`。开发环境由 Vite 代理，生产环境配置同域反向代理。金额使用元字符串，时间使用 ISO 8601 UTC；显示时转换为用户本地时间。

## 认证与请求约定

- `POST /auth/login` 返回当前员工、权限、菜单、表单定义和 `csrfToken`，并设置 HttpOnly、SameSite=Strict 的 `workflow_session` Cookie。
- 其余接口读取 Cookie 会话；写入还需 `x-csrf-token`。浏览器写入来源必须与 `APP_ORIGIN` 一致。前端统一封装在 `apps/web/src/api/`。
- 工单写操作必须带幂等键。草稿创建／保存、附件上传通过 `idempotency-key` 请求头，其余通过 JSON 的 `idempotencyKey`。
- 操作者始终取服务端会话，不接受前端提交任意操作者、组织范围或下一节点。
- 主单动作携带 `expectedVersion`，个人任务携带 `expectedTaskVersion`，流程调整携带 `expectedStructureRevision`，配置携带 `expectedDraftRevision`。

统一错误：

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "工单已变化，请刷新", "details": [] } }
```

401 表示会话无效；403 表示无权或来源／CSRF 不符；404 表示资源不存在或不可见；409 表示版本／幂等冲突；422 表示业务校验失败；429 表示限流；503 表示服务或数据库暂不可用。

## 接口清单

| 方法 | 路径 | 入参 / 返回 |
| --- | --- | --- |
| GET | /health | 存活状态；不访问数据库 |
| POST | /auth/login | username、password → SessionProfile |
| GET | /auth/me | 当前账号、权限、动态菜单、当前表单和 CSRF |
| POST | /auth/logout | 撤销当前会话 |
| POST | /auth/password | currentPassword、password → 撤销本人全部旧会话 |
| GET | /pages/:id | 返回当前身份被授权的页面定义 |
| GET | /activities | q、status、scope、page、pageSize → 分页列表 |
| GET | /activities/export | 当前搜索／状态／scope → 授权 CSV，最多2000条 |
| POST | /activities | payload → 草稿 id、version |
| PATCH | /activities/:id | payload、expectedVersion → id、version |
| GET | /activities/:id | activity、files、actions、participants、taskWarnings |
| POST | /activities/:id/submit | expectedVersion、idempotencyKey → id、version |
| POST | /tasks/:id/decisions | expectedTaskVersion、decision、comment、idempotencyKey |
| POST | /tasks/:id/transfer | expectedTaskVersion、assignee、reason、idempotencyKey |
| POST | /activities/:id/adjustments | name、kind、assignee、anchor、position、reason、expectedStructureRevision、idempotencyKey |
| POST | /activities/:id/actions | action、expectedVersion、comment、动作所需字段、idempotencyKey |
| POST | /workflow/preview | payload → 解析节点、参与人和路线错误，不创建工单 |
| GET | /directory | 有效成员、部门、受控角色选项 |
| GET | /config | 管理员读取 published、draft、revision、draftRevision |
| PUT | /config/draft | draft、expectedDraftRevision → 新配置状态 |
| POST | /config/publish | expectedDraftRevision → 发布及物化的新版本 |
| POST | /members/:id/password | password → 修改已发布成员密码并撤销旧会话 |
| POST | /activities/:id/files?stage=application | multipart file；stage 还支持 execution、archive |
| GET | /files/:id | 鉴权后以 attachment 下载文件 |
| GET | /activities/:id/export | 鉴权、排除联系方式并审计后下载单工单 CSV |
| GET | /notifications | 当前成员最近100条站内消息 |
| POST | /notifications/:id/read | 仅将本人消息标记已读 |

`scope` 可选 `all`、`mine`、`tasks`、`archives`，均在当前账号数据权限之内缩小范围，`all` 不代表全公司授权。列表默认每页20条，最大100条。待办按活动聚合，任务明细在详情中返回。

## 动作字段

| action | 附加字段与业务规则 |
| --- | --- |
| withdraw | 申请人在审批中撤回，关闭剩余待办 |
| assign | executor、至少5字 comment；执行人需具备权限及覆盖范围 |
| start | 当前执行人办理，须已到计划开始时间 |
| report | report.start、end、people、summary、spend、exception；摘要至少10字 |
| archive-submit | 至少10字 comment，HTTPS url 或已成功上传成果附件 |
| archive-approve | checks 三个布尔值全部为 true；禁止审核本人提交档案 |
| archive-return | 至少5字 comment，保留退回版本 |
| cancel-request | 至少5字 comment；执行中还需至少5字 disposal |
| cancel-approve | 指定取消审核人批准，进入 cancelled |
| cancel-reject | 至少5字 comment，恢复原状态 |
| cancel-withdraw | 取消申请发起人撤销，恢复原状态 |

审批 `decision` 为 approve、return、reject，后两者意见至少5字；普通任务／知会只允许 approve 完成。动态 `kind` 为 approval、task、notice，`position` 为 before、after、parallel；`assignee` 为 `{ "type": "manager|role|user", "value": "角色或成员标识" }`。manager 的 value 为空字符串。

## 文件与数据边界

文件按申请、执行、归档三个阶段校验上传资格；单文件20MB、单阶段10个，支持基础签名和扩展名一致的 PDF、JPG、PNG、DOCX、XLSX。存储键由服务端生成，不接受客户端磁盘路径。Office 文件当前检查 ZIP 容器签名，后续可接内容扫描或对象存储。

完整接口类型在 `packages/domain/src/types.ts`、请求校验在 `packages/domain/src/schemas.ts`，前端返回类型在 `apps/web/src/typings/api/index.d.ts`。这些类型与接口实现共同维护，历史设计文档中的建议 URL 以本清单为准。
