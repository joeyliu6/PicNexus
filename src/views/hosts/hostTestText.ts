// 测试连接的结果说法（P07 / P08）：成功写清过了哪几步，失败指到具体字段 + 处理办法（交接说明 9：错误 = 原因 + 处理办法）。

import { joinCjk } from '@/utils/cjkSpacing';
import type { HostDescriptor, TestStep } from './hostCatalog';

export type HostTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; ms: number; steps: TestStep[] }
  | {
    phase: 'fail';
    step: TestStep;
    /** 标红的那一格（HostField.key），指不到时为空 */
    field?: string;
    /** 字段下面的红字 / 结果条里的原因 */
    reason: string;
    /** 之前几步通过了 */
    passed: TestStep[];
  };

/** 后端的通用字段名 → 各图床的配置键（取这个图床表单里有的第一个） */
const FIELD_KEYS: Record<string, string[]> = {
  account_id: ['accountId'],
  access_key: ['accessKeyId', 'secretId', 'accessKey', 'operator'],
  secret_key: ['secretAccessKey', 'secretKey', 'accessKeySecret', 'password'],
  s3_access_key: ['s3AccessKey'],
  bucket: ['bucketName', 'bucket'],
  region: ['region'],
  endpoint: ['endpoint'],
  public_domain: ['publicDomain'],
  url: ['url'],
  password: ['passwordEncrypted'],
  cookie: ['cookie'],
  token: ['token', 'clientId'],
  repo: ['repo'],
  branch: ['branch'],
};

export function resolveField(descriptor: HostDescriptor, generic: string | null | undefined): string | undefined {
  if (!generic) return undefined;
  const keys = FIELD_KEYS[generic] ?? [generic];
  return keys.find((key) => descriptor.fields.some((f) => f.key === key));
}

/** 各家后台怎么称呼（「请在 Cloudflare 后台重新复制后再试」） */
const CONSOLES: Record<string, string> = {
  r2: 'Cloudflare 后台',
  tencent: '腾讯云控制台',
  aliyun: '阿里云控制台',
  qiniu: '七牛云控制台',
  upyun: '又拍云控制台',
  github: 'GitHub',
  smms: 'SM.MS',
  imgur: 'Imgur',
};

/** 原因里「服务商」换成这家的名字（「Cloudflare 拒绝了签名」） */
const PROVIDER_NAMES: Record<string, string> = { r2: 'Cloudflare', tencent: '腾讯云', aliyun: '阿里云', qiniu: '七牛云', upyun: '又拍云' };

export function localizeReason(descriptorId: string, reason: string): string {
  const name = PROVIDER_NAMES[descriptorId];
  if (!name) return reason;
  return reason.split('服务商').reduce((out, part, i) => (i === 0 ? part : joinCjk(out, name, part)), '');
}

const STEP_WORDS: Record<TestStep, string> = { credentials: '读取', write: '写入', public: '公开访问' };

/** 成功结果条后半句：三步「读取、写入、公开访问均通过」；只有一步「凭证有效 / 登录有效」；免配置不写 */
export function okDetail(descriptor: HostDescriptor, steps: readonly TestStep[]): string {
  if (steps.length === 0) return '';
  if (steps.length === 1) return descriptor.kind === 'cookie' ? '登录有效' : '凭证有效';
  return `${steps.map((s) => STEP_WORDS[s]).join('、')}均通过`;
}

/** 失败结果条：粗体标题 + 灰色的「之前几步通过了 + 处理办法」 */
export function failSummary(descriptor: HostDescriptor, state: Extract<HostTestState, { phase: 'fail' }>): { title: string; detail: string } {
  const field = state.field ? descriptor.fields.find((f) => f.key === state.field) : undefined;
  const title = field ? `${field.label} 无效` : state.reason;
  const passed = state.passed.length === 0 ? '' : state.passed.length === 1 ? '凭证有效' : `${state.passed.map((s) => STEP_WORDS[s]).join('与')}均通过`;
  // 指不到字段、原因里已经带了处理办法（「连接超时，请检查网络后重试」）时不再重复一句
  const advice = !field && /请/.test(state.reason) ? '' : adviceFor(descriptor, state);
  return { title, detail: [passed, advice].filter(Boolean).join('，') };
}

function adviceFor(descriptor: HostDescriptor, state: Extract<HostTestState, { phase: 'fail' }>): string {
  const console = CONSOLES[descriptor.id] ?? '服务商后台';
  switch (state.field) {
    case 'cookie':
      return '请重新登录';
    case 'token':
    case 'clientId':
    case 'secretAccessKey':
    case 'secretKey':
    case 'accessKeySecret':
    case 'password':
    case 'accessKeyId':
    case 'secretId':
    case 'accessKey':
    case 'operator':
    case 's3AccessKey':
      return joinCjk('请在', console, '重新复制后再试');
    case 'passwordEncrypted':
      return '请检查用户名和密码';
    case 'bucket':
    case 'bucketName':
      return '请检查存储桶名称';
    case 'repo':
      return '请检查仓库名称';
    case 'branch':
      return '请检查分支名称';
    case 'publicDomain':
      return '请检查公开访问域名';
    case 'url':
    case 'endpoint':
      return '请检查地址';
    case 'region':
      return '请检查地域';
    case 'accountId':
      return joinCjk('请在', console, '重新复制 Account ID');
    default:
      return state.step === 'write' ? '请检查密钥的写入权限' : '请稍后重试';
  }
}
