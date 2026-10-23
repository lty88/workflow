import { Badge, ExtensionCategory, Label, Rect, register } from '@antv/g6'
import type { LabelStyleProps, RectStyleProps } from '@antv/g6'
import type { OrganizationCardMeta } from './types'

type CardStyle = Required<RectStyleProps>
type CardContainer = Parameters<Rect['render']>[1]
const NODE_TYPE = 'workflow-organization-card'
let registered = false

/** 参考官方组织卡片，以真实部门状态展示负责人、人数及缩放分级信息。 */
class OrganizationCard extends Rect {
  /** 读取当前节点业务信息。
   * @returns 部门或成员的展示元数据
   */
  private get card(): OrganizationCardMeta {
    return this.context.model.getElementDataById(this.id).data as unknown as OrganizationCardMeta
  }
  /** 根据真实画布缩放决定是否仅展示部门名称。
   * @returns 是否采用概览卡片
   */
  private get overview(): boolean {
    return this.card.overview === true
  }
  /** 保留选中态边框，概览使用分支颜色，详细模式使用白底。
   * @param attributes G6计算后的节点样式
   * @returns 卡片底板样式
   */
  protected getKeyStyle(attributes: CardStyle) {
    const base = super.getKeyStyle(attributes)
    return { ...base, fill: this.overview ? this.card.accent : this.card.root ? '#f0f5ff' : '#ffffff' }
  }
  /** 布置部门标题，缩小时仅保留高对比名称，详细模式预留状态徽标空间。
   * @param attributes G6节点样式
   * @returns 标题文字样式
   */
  protected getLabelStyle(attributes: CardStyle): LabelStyleProps {
    return {
      ...(super.getLabelStyle(attributes) || {}),
      text: this.card.label,
      fill: this.overview ? '#ffffff' : '#1e304b',
      fontSize: this.overview ? 22 : 17,
      fontWeight: 600,
      textAlign: this.overview ? 'center' : 'left',
      textBaseline: 'middle',
      wordWrap: true,
      wordWrapWidth: this.overview ? 246 : 166,
      maxLines: this.overview ? 2 : 1,
      textOverflow: 'ellipsis',
      transform: [['translate', this.overview ? 0 : -124, this.overview ? 0 : -39]],
    }
  }
  /** 绘制真实状态、负责人和组织统计；概览模式移除细节以保持清晰。
   * @param attributes G6节点样式，默认使用当前计算结果
   * @param container 绘制容器，默认使用当前节点
   */
  public render(attributes: CardStyle = this.parsedAttributes, container: CardContainer = this): void {
    super.render(attributes, container)
    const detail = !this.overview
    const data = this.card
    this.upsert(
      'org-status',
      Badge,
      detail
        ? {
            text: data.statusLabel,
            fontSize: 12,
            fill: data.statusColor,
            backgroundFill: data.statusBackground,
            backgroundRadius: 5,
            padding: [4, 7],
            textAlign: 'center',
            transform: [['translate', 100, -39]],
          }
        : false,
      container
    )
    this.upsert(
      'org-manager',
      Label,
      detail
        ? {
            text: data.caption,
            fontSize: 14,
            fill: '#536780',
            textAlign: 'left',
            textBaseline: 'middle',
            wordWrap: true,
            wordWrapWidth: 245,
            maxLines: 1,
            textOverflow: 'ellipsis',
            transform: [['translate', -124, -7]],
          }
        : false,
      container
    )
    this.upsert(
      'org-metrics',
      Label,
      detail
        ? {
            text: data.metrics,
            fontSize: 13,
            fill: data.accent,
            fontWeight: 500,
            textAlign: 'left',
            textBaseline: 'middle',
            transform: [['translate', -124, 32]],
          }
        : false,
      container
    )
    this.upsert(
      'org-level',
      Label,
      detail
        ? {
            text: data.levelLabel,
            fontSize: 12,
            fill: '#8693a7',
            textAlign: 'right',
            textBaseline: 'middle',
            transform: [['translate', 124, 32]],
          }
        : false,
      container
    )
  }
}

/** 注册组织专用节点一次，复用共享画布而不改变流程图节点。
 * @returns G6自定义节点类型名称
 */
export function registerOrganizationCard(): string {
  if (!registered) {
    register(ExtensionCategory.NODE, NODE_TYPE, OrganizationCard)
    registered = true
  }
  return NODE_TYPE
}
