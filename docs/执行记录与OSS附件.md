# 执行记录与OSS附件

## 产品流程

审批完成 → 最后审批人指派执行人 → 开始执行 → 多次新增执行记录 → 执行人手动确认完成 → 执行人补充成果并提交归档 → 最后审批人审核归档。

“新增执行记录”保存本次日报或阶段进展，活动保持执行中，支持继续新增。每条包含标题、起止时间、本次人数、进展、当次支出、异常说明、提交人和提交时间，以及独立附件。

筹备类记录允许参会人数为0。每次人数仅说明当次记录，最终人数由执行人在完成表单单独确认，避免多日参会人员重复累加。最终总支出也需单独确认。

提交至少一条记录后，“完成执行并提交归档”才向执行人开放。完成表单确认最终时间、人数、总支出和整体成果；确认后记录只读，活动进入待归档，执行人继续整理成果并提交归档，由最后审批人审核。匿名评价从手动完成执行后开放。

历史活动已有单次汇报保留为“执行完成汇总”，不自动拆分为多条日报。

## 界面与附件覆盖

- 执行与归档分区：阶段提示、执行负责人、记录数量、最近记录、执行安排、倒序记录时间线、最终汇总、归档成果。
- 记录超过10条时分批展开，单条记录独立展示已授权附件。
- 底部操作栏和执行分区均可新增记录或完成执行；从底栏办理时自动定位执行分区。
- 活动创建的每个步骤都提供补充附件，首次上传自动保存当前申请。
- 审批、节点任务、执行记录、完成汇总、执行指派、撤回、取消、归档提交与审核、流程调整和待办转交、删除确认等活动业务表单提供选填附件。
- 每份表单或记录最多10个附件，每个不超过20MB；支持PDF、JPG、PNG、DOCX、XLSX，服务端验证文件签名。

上传期间禁止提交表单或关闭办理抽屉。上传后先刷新附件与活动版本，再允许提交，避免本次上传产生版本冲突。

## 数据与权限

- `execution_records`：每条执行记录独立一行，主键为`activity_id,id`，记录提交人、时间及具体内容。只追加、不覆盖旧记录。
- `activities.data.report`：最终完成汇总；`executionCompletedAt`记录手动完成时间。详情接口读取独立记录表，不把所有日报重复存进活动JSON。
- `files.context_id`：对应一次表单或执行记录；`action_key`记录动作归属。
- `audit_events.data.attachmentContextId`：让本次操作与其附件一同追溯。
- 同次提交的文件必须属于同一活动、上传人、节点和业务动作。已提交记录的附件不可追加覆盖，补充材料应新增一条记录。
- 尚未正式提交的分组附件只对上传人开放，提交后再按节点与附件规则展示。查看和下载继续分别授权；每条记录的支出继承预算字段的读取与导出限制。
- 第8版迁移新增记录表和附件列、扩展`storage_key`到512字符，保留现有活动及文件。本机已执行；其他环境在项目根目录运行`pnpm db:migrate`。

## OSS配置

根目录`.env`是服务端实际配置；[配置模板](../config/oss.env.example)提供完整字段。不要使用`VITE_`前缀保存密钥。

```dotenv
STORAGE_DRIVER=oss
OSS_REGION=oss-cn-beijing
OSS_BUCKET=qyzh2025test
OSS_DOMAIN=https://oss-test.qyzhjy.com
OSS_PREFIX=workflow
OSS_ACCESS_KEY_ID=填写真实AccessKeyID
OSS_ACCESS_KEY_SECRET=填写真实AccessKeySecret
```

目前提供的`xxxx`为占位值，本机仍保留`STORAGE_DRIVER=local`。填好真实ID和Secret后切换为`oss`，重启服务，新上传文件即写入OSS。启用OSS但没有有效凭据时，启动校验给出明确提示。

使用阿里云官方`ali-oss`SDK，启用V4签名和自定义域名CNAME，写入对象显式设为私有。域名需已绑定桶并具备有效HTTPS证书。凭据需允许对象上传、读取、删除、读取元数据；PUT通过对象摘要核对响应丢失后的重试。

前端封装在`apps/web/src/api/oss.ts`，通过登录接口提交文件；服务端统一做业务权限、大小和类型验证，再转存OSS。下载与预览也由服务端授权后代理，不向浏览器发送长期密钥或绕过权限的公开对象地址。该方案不需要浏览器直连OSS的CORS配置。

旧本地文件仍通过原路径读取。已存储的OSS对象键保留目录前缀；切换桶或自定义域名前应迁移历史对象，保持路径可读。

参考：[阿里云自定义域名SDK配置](https://help.aliyun.com/en/oss/developer-reference/use-custom-domain-names)、[V4签名说明](https://www.alibabacloud.com/help/en/oss/developer-reference/recommend-to-use-signature-version-4)。

## 接口

1. `POST /api/activities/:id/files?stage=...`：`multipart/form-data`，先发`access` JSON，再发`file`。业务表单access包含`contextId`与`actionKey`；节点附件还包含`nodeId`。
2. `POST /api/activities/:id/actions`：`action=report`追加记录；`action=execution-complete`保存完成汇总并进入归档。两者沿用`expectedVersion`、`idempotencyKey`和`report`，增加`attachmentContextId`。
3. 审批、调整、转交接口也支持`attachmentContextId`，业务提交与附件归属在同一事务中完成。
4. `GET /api/activities/:id`返回`activity.executionRecords`及授权附件；`GET /api/files/:id`和`GET /api/files/:id/preview`保留独立下载与预览权限。

## 验证范围

执行类型检查、前端结构检查，以及状态机、记录持久化、权限投影、附件归属和SDK替身的局部回归。真实OSS上传需要填入有效凭据后验证；本次未启动应用或浏览器。
