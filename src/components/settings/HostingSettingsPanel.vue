<script setup lang="ts">
/**
 * 图床设置统一面板
 * 使用折叠面板（Accordion）形式整合所有图床配置
 * 分类：私有图床、开箱即用、Cookie认证、Token认证
 */
import { ref } from 'vue';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import PrivateHostingPanel from './PrivateHostingPanel.vue';
import BuiltinHostingPanel from './BuiltinHostingPanel.vue';
import CookieAuthHostingPanel from './CookieAuthHostingPanel.vue';
import TokenAuthHostingPanel from './TokenAuthHostingPanel.vue';

// Props 定义
interface PrivateHostingFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  cos: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  oss: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; domain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; domain: string; path: string };
}

interface CookieFormData {
  weibo: { cookie: string };
  zhihu: { cookie: string };
  nowcoder: { cookie: string };
  nami: { cookie: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
}

interface TokenFormData {
  smms: { token: string };
  github: { token: string; owner: string; repo: string; branch: string; path: string; customDomain?: string };
  imgur: { clientId: string; clientSecret?: string };
}

const props = defineProps<{
  privateFormData: PrivateHostingFormData;
  cookieFormData: CookieFormData;
  tokenFormData: TokenFormData;
  testingConnections: Record<string, boolean>;
  // 开箱即用检测状态
  jdAvailable: boolean;
  qiyuAvailable: boolean;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
  testToken: [providerId: string];
  testCookie: [providerId: string];
  checkBuiltin: [providerId: string];
  loginCookie: [providerId: string];
}>();

// 默认展开的面板（可以同时展开多个）
const activeAccordions = ref<number[]>([]);

// 处理保存
const handleSave = () => {
  emit('save');
};

// 处理私有图床测试
const handleTestPrivate = (providerId: string) => {
  emit('testPrivate', providerId);
};

// 处理 Token 图床测试
const handleTestToken = (providerId: string) => {
  emit('testToken', providerId);
};

// 处理 Cookie 图床测试
const handleTestCookie = (providerId: string) => {
  emit('testCookie', providerId);
};

// 处理开箱即用检测
const handleCheckBuiltin = (providerId: string) => {
  emit('checkBuiltin', providerId);
};

// 处理 Cookie 自动获取
const handleLoginCookie = (providerId: string) => {
  emit('loginCookie', providerId);
};
</script>

<template>
  <div class="hosting-settings-panel">
    <!-- 页面标题 -->
    <div class="panel-header">
      <h2>图床设置</h2>
      <p class="header-desc">根据认证方式和使用场景选择合适的图床服务</p>
    </div>

    <!-- 折叠面板 -->
    <Accordion :value="activeAccordions" multiple class="hosting-accordion">
      <!-- 云存储 -->
      <AccordionPanel value="0">
        <AccordionHeader>
          <div class="accordion-title">
            <i class="pi pi-cloud"></i>
            <span>云存储</span>
            <span class="category-count">5</span>
          </div>
        </AccordionHeader>
        <AccordionContent>
          <PrivateHostingPanel
            :formData="privateFormData"
            :testingConnections="testingConnections"
            @save="handleSave"
            @test="handleTestPrivate"
          />
        </AccordionContent>
      </AccordionPanel>

      <!-- 免配置图床 -->
      <AccordionPanel value="1">
        <AccordionHeader>
          <div class="accordion-title">
            <i class="pi pi-bolt"></i>
            <span>免配置图床</span>
            <span class="category-count">2</span>
          </div>
        </AccordionHeader>
        <AccordionContent>
          <BuiltinHostingPanel
            :jdAvailable="jdAvailable"
            :qiyuAvailable="qiyuAvailable"
            :isCheckingJd="isCheckingJd"
            :isCheckingQiyu="isCheckingQiyu"
            @check="handleCheckBuiltin"
          />
        </AccordionContent>
      </AccordionPanel>

      <!-- Cookie 认证 -->
      <AccordionPanel value="2">
        <AccordionHeader>
          <div class="accordion-title">
            <svg class="category-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 128C299.946667 128 128 299.946667 128 512 128 724.053333 299.946667 896 512 896 724.053333 896 896 724.053333 896 512 896 490.666667 894.293333 469.333333 890.453333 448 878.933333 426.666667 853.333333 426.666667 853.333333 426.666667L768 426.666667 768 384C768 341.333333 725.333333 341.333333 725.333333 341.333333L640 341.333333 640 298.666667C640 256 597.333333 256 597.333333 256L554.666667 256 554.666667 170.666667C554.666667 128 512 128 512 128M405.333333 256C440.746667 256 469.333333 284.586667 469.333333 320 469.333333 355.413333 440.746667 384 405.333333 384 369.92 384 341.333333 355.413333 341.333333 320 341.333333 284.586667 369.92 256 405.333333 256M277.333333 426.666667C312.746667 426.666667 341.333333 455.253333 341.333333 490.666667 341.333333 526.08 312.746667 554.666667 277.333333 554.666667 241.92 554.666667 213.333333 526.08 213.333333 490.666667 213.333333 455.253333 241.92 426.666667 277.333333 426.666667M490.666667 469.333333C526.08 469.333333 554.666667 497.92 554.666667 533.333333 554.666667 568.746667 526.08 597.333333 490.666667 597.333333 455.253333 597.333333 426.666667 568.746667 426.666667 533.333333 426.666667 497.92 455.253333 469.333333 490.666667 469.333333M704 554.666667C739.413333 554.666667 768 583.253333 768 618.666667 768 654.08 739.413333 682.666667 704 682.666667L704 682.666667C668.586667 682.666667 640 654.08 640 618.666667L640 618.666667C640 583.253333 668.586667 554.666667 704 554.666667M469.333333 682.666667C504.746667 682.666667 533.333333 711.253333 533.333333 746.666667 533.333333 782.08 504.746667 810.666667 469.333333 810.666667 433.92 810.666667 405.333333 782.08 405.333333 746.666667 405.333333 711.253333 433.92 682.666667 469.333333 682.666667Z" fill="currentColor"/></svg>
            <span>Cookie 认证</span>
            <span class="category-count">6</span>
          </div>
        </AccordionHeader>
        <AccordionContent>
          <CookieAuthHostingPanel
            :formData="cookieFormData"
            :testingConnections="testingConnections"
            @save="handleSave"
            @test="handleTestCookie"
            @login="handleLoginCookie"
          />
        </AccordionContent>
      </AccordionPanel>

      <!-- Token 认证 -->
      <AccordionPanel value="3">
        <AccordionHeader>
          <div class="accordion-title">
            <svg class="category-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M412.8 396.8c0 54.4 44.8 99.2 99.2 99.2s99.2-44.8 99.2-99.2-44.8-99.2-99.2-99.2-99.2 44.8-99.2 99.2z" fill="currentColor"/><path d="M512 12.8C380.8 102.4 246.4 147.2 112 147.2v313.6c0 179.2 89.6 342.4 236.8 441.6l163.2 108.8 163.2-108.8c147.2-99.2 236.8-265.6 236.8-441.6V147.2c-134.4 0-265.6-44.8-400-134.4z m32 547.2v64h99.2v67.2H544v105.6h-64v-236.8c-76.8-16-134.4-83.2-134.4-163.2 0-92.8 73.6-166.4 166.4-166.4s166.4 73.6 166.4 166.4c0 80-57.6 147.2-134.4 163.2z" fill="currentColor"/></svg>
            <span>Token 认证</span>
            <span class="category-count">3</span>
          </div>
        </AccordionHeader>
        <AccordionContent>
          <TokenAuthHostingPanel
            :formData="tokenFormData"
            :testingConnections="testingConnections"
            @save="handleSave"
            @test="handleTestToken"
          />
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>

<style scoped>
.hosting-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

/* 页面标题 */
.panel-header {
  margin-bottom: 32px;
}

.panel-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.header-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* Accordion 样式 */
.hosting-accordion {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Accordion 标题样式 */
.accordion-title {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
}

.accordion-title i {
  font-size: 1.125rem;
  color: var(--primary-color);
}

/* 自定义 SVG 图标样式 */
.accordion-title .category-icon {
  width: 1.125rem;
  height: 1.125rem;
  color: var(--primary-color);
  flex-shrink: 0;
}

.category-count {
  margin-left: auto;
  margin-right: 12px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-secondary);
  padding: 4px 10px;
  border-radius: 12px;
  min-width: 28px;
  text-align: center;
}

/* 保持滚动条空间稳定，避免内容宽度跳变 */
:deep(.p-accordioncontent-content) {
  scrollbar-gutter: stable;
}

/* 修复暗黑模式 Accordion 背景色过深 */
:deep(.p-accordionpanel) {
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
}

:deep(.p-accordionheader) {
  background: var(--bg-card);
  border: none;
  padding: 16px 20px;
}

:deep(.p-accordionheader:hover) {
  background: var(--bg-card);
}

:deep(.p-accordionheader-toggle-icon) {
  color: var(--text-muted);
}

:deep(.p-accordioncontent) {
  background: transparent;
  border: none;
}

:deep(.p-accordioncontent-content) {
  padding: 20px;
  background: transparent;
}

/* 响应式 */
@media (max-width: 768px) {
  .panel-header h2 {
    font-size: 1.25rem;
  }

  .accordion-title {
    font-size: 0.9375rem;
  }
}
</style>
