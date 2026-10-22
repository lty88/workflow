<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NInput, NRate, NResult, NSpin, NTag } from 'naive-ui';
import { EVALUATION_DIMENSIONS, evaluationInputSchema } from '@workflow/domain';
import type { EvaluationInput, PublicEvaluation } from '@/typings/api/insights';
import { publicEvaluationApi, submitEvaluationApi } from '@/api/insights';
const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
const info = ref<PublicEvaluation | null>(null);
const loading = ref(false);
const submitting = ref(false);
const errorText = ref('');
const submitError = ref('');
const submitted = ref(false);
const form = ref<EvaluationInput>({
  overall: 0,
  content: 0,
  organization: 0,
  usefulness: 0,
  comment: '',
});
const ready = computed(() => EVALUATION_DIMENSIONS.every((dimension) => form.value[dimension.key] > 0));
const scoreLabels = ['', '很不满意', '不满意', '一般', '满意', '非常满意'];

/** 读取免登录问卷；无效、关闭、过期或已提交时显示对应状态。 */
async function load(): Promise<void> {
  errorText.value = '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
    errorText.value = '评价链接不完整，请向活动组织者索取新的链接或二维码。';
    return;
  }
  loading.value = true;
  try {
    info.value = await publicEvaluationApi(token);
    submitted.value = info.value.submitted;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '评价读取失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

/** 校验四项评分后匿名提交，失败保留已填写内容，成功后切换为感谢页。 */
async function submit(): Promise<void> {
  if (submitting.value || submitted.value) return;
  const input = evaluationInputSchema.safeParse(form.value);
  if (!input.success) {
    submitError.value = '请为四个项目分别选择1至5星。';
    return;
  }
  submitting.value = true;
  submitError.value = '';
  try {
    await submitEvaluationApi(token, input.data);
    submitted.value = true;
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '提交失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}
onMounted(load);
</script>
<template>
  <main class="public-evaluation">
    <header class="evaluation-brand">
      <span>评</span><strong>活动体验反馈</strong><NTag round :bordered="false" type="info">匿名填写</NTag>
    </header>
    <NSpin :show="loading">
      <NCard v-if="errorText" class="evaluation-card"
        ><NResult status="warning" title="暂时无法填写" :description="errorText"
          ><template #footer><NButton @click="load">重新读取</NButton></template></NResult
        ></NCard
      >
      <NCard v-else-if="submitted" class="evaluation-card"
        ><NResult
          status="success"
          title="感谢你的评价"
          description="你的反馈已收到，将帮助我们把下一场活动办得更好。"
          ><template #footer><p>本浏览器已完成提交，可以关闭此页面。</p></template></NResult
        ></NCard
      >
      <template v-else-if="info">
        <section class="evaluation-intro">
          <p>每一份反馈，都让下一次更好</p>
          <h1>{{ info.activityName }}</h1>
          <span>约需 1 分钟 · 无需账号登录</span>
        </section>
        <NCard class="evaluation-card">
          <h2>这次活动，你觉得怎么样？</h2>
          <p class="evaluation-note">1 星很不满意，5 星非常满意。四项评分均为必填。</p>
          <div v-for="(dimension, index) in EVALUATION_DIMENSIONS" :key="dimension.key" class="rating-item">
            <div>
              <strong
                ><span>{{ String(index + 1).padStart(2, '0') }}</span
                >{{ dimension.label }}</strong
              ><span class="rating-description">{{ scoreLabels[form[dimension.key]] || '请选择' }}</span>
            </div>
            <NRate v-model:value="form[dimension.key]" :size="34" :aria-label="dimension.label" />
          </div>
          <label for="evaluation-comment" class="comment-label">你的建议 <span>选填</span></label>
          <NInput
            id="evaluation-comment"
            v-model:value="form.comment"
            type="textarea"
            placeholder="哪些内容对你有帮助？还有哪些地方可以改进？请勿填写个人联系方式或敏感信息。"
            :maxlength="1000"
            show-count
            :autosize="{ minRows: 4, maxRows: 8 }"
          />
          <NAlert v-if="submitError" type="error" class="evaluation-error">{{ submitError }}</NAlert>
          <NButton
            type="primary"
            size="large"
            block
            :loading="submitting"
            :disabled="!ready"
            class="submit-evaluation"
            @click="submit"
            >提交匿名评价</NButton
          >
          <p class="evaluation-privacy">
            不收集姓名和手机号；活动组织者可查看匿名反馈。同一浏览器每场活动提交一次。
          </p>
        </NCard>
      </template>
    </NSpin>
    <footer>认真倾听 · 持续改进</footer>
  </main>
</template>
<style scoped>
.public-evaluation {
  max-width: 640px;
  margin: 0 auto;
  padding: 28px 20px 36px;
  color: #24334d;
  font-size: 14px;
}
.evaluation-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}
.evaluation-brand > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: #235de9;
  color: white;
  font-size: 20px;
}
.evaluation-brand strong {
  flex: 1;
  font-size: 16px;
}
.evaluation-intro {
  margin-bottom: 26px;
}
.evaluation-intro p {
  color: #4770b6;
  margin: 0 0 12px;
}
.evaluation-intro h1 {
  font-size: 28px;
  line-height: 1.5;
  margin: 0 0 12px;
}
.evaluation-intro > span,
.evaluation-note {
  color: #697991;
}
.evaluation-card {
  border-radius: 18px !important;
  box-shadow: 0 12px 40px #243c6e08;
}
.evaluation-card h2 {
  font-size: 20px;
  margin: 0 0 8px;
}
.evaluation-note {
  line-height: 1.8;
  margin-bottom: 14px;
}
.rating-item {
  padding: 20px 0;
  border-bottom: 1px solid #edf0f5;
}
.rating-item > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.rating-item strong > span {
  color: #91a0b6;
  font-size: 12px;
  margin-right: 10px;
}
.rating-description {
  font-size: 13px;
  color: #697991;
}
.comment-label {
  display: block;
  margin: 24px 0 12px;
  font-weight: 600;
}
.comment-label span {
  font-weight: 400;
  color: #91a0b6;
  margin-left: 6px;
  font-size: 13px;
}
.submit-evaluation {
  margin-top: 24px;
}
.evaluation-privacy {
  font-size: 12px;
  line-height: 1.8;
  color: #718098;
  margin: 16px 0 0;
}
.evaluation-error {
  margin-top: 16px;
}
.public-evaluation footer {
  text-align: center;
  color: #91a0b6;
  margin-top: 28px;
  font-size: 12px;
}
@media (max-width: 480px) {
  .public-evaluation {
    padding: 20px 16px;
  }
  .evaluation-intro h1 {
    font-size: 24px;
  }
  .evaluation-brand {
    margin-bottom: 28px;
  }
}
</style>
