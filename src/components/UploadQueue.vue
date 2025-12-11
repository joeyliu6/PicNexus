<script setup lang="ts">
import { writeText } from '@tauri-apps/api/clipboard';
import type { ServiceType } from '../config/types';
import ProgressBar from 'primevue/progressbar';
import { useToast } from '../composables/useToast';
import { useQueueState } from '../composables/useQueueState';
import type { QueueItem } from '../uploadQueue';
import { deepClone, deepMerge } from '../utils/deepClone';

const toast = useToast();
const { queueItems } = useQueueState();

// 重试回调函数
let retryCallback: ((itemId: string, serviceId?: ServiceType) => void) | null = null;

const handleRetry = (itemId: string, serviceId?: ServiceType) => {
  if (retryCallback) {
    retryCallback(itemId, serviceId);
  }
};

// 图床名称映射
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'R2',
  tcl: 'TCL',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米'
};

// 渠道图标 SVG
const serviceIcons: Partial<Record<ServiceType, string>> = {
  qiyu: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M923.52 557.376a239.872 239.872 0 0 0 55.104-125.888c14.848-96.768-34.944-131.136-72.064-119.68-47.744 14.592-50.944 76.992-18.048 124.8 21.184 31.296 42.432 66.624 25.472 105.152-5.312 11.456-7.424 36.416 9.536 15.616z" fill="#000000"></path><path d="M946.816 561.536c-36.032 58.24-80.576 108.16-190.848 104-121.984-4.16-221.632-90.496-227.968-211.2-9.6-114.432 28.608-279.872-91.2-330.88C289.28 62.08 27.456 166.208 43.328 477.312c12.8 248.64 218.496 440.064 470.848 440.064 208.896 0 400.832-138.368 456-340.224 10.56-35.328-9.6-36.416-23.36-15.552zM358.272 381.44a35.456 35.456 0 1 1 0-70.72c20.16 0 36.096 15.616 36.096 35.328a36.096 36.096 0 0 1-36.096 35.392z" fill="#000000"></path></svg>',
  nami: '<svg viewBox="0 0 1040 1024" xmlns="http://www.w3.org/2000/svg"><path d="M414.461028 111.86733L490.348259 146.892206v87.562189L472.835821 251.966833l-70.049751 23.349917-52.537314-40.862355v-81.72471l17.512438-5.837479 46.699834-35.024876zM402.78607 672.26534l87.562189 40.862355v81.72471l-17.512438 5.837479-58.374793 35.024876-64.212272-35.024876v-87.562189l17.512438-17.512438 35.024876-23.349917z" opacity=".824"></path><path d="M204.311774 263.641791l11.674959 23.349917-11.674959-23.349917zM729.684909 286.991708l5.837479 87.562189h-11.674958l5.837479-87.562189zM110.912106 368.716418l11.674959 23.349917-11.674959-23.349917zM309.386401 380.391376l11.674959 23.349918-11.674959-23.349918zM145.936982 392.066335l17.512438 17.512438v128.424544l-23.349918 11.674958 11.674959-11.674958v-128.424544l-5.837479-17.512438zM694.660033 392.066335l-5.837479 17.512438v128.424544l11.674958 11.674958-23.349917-11.674958v-128.424544l17.512438-17.512438zM449.485904 403.741294l11.674958 23.349917-11.674958-23.349917zM332.736318 438.766169l11.674959 23.349917-11.674959-23.349917zM461.160862 520.490879l17.512438 5.837479-29.187396 17.512438 11.674958-23.349917zM122.587065 555.515755l-11.674959 23.349917 11.674959-23.349917zM729.684909 567.190713l5.837479 87.562189h-11.674958l5.837479-87.562189z" fill="#E0041B" opacity=".863"></path><path d="M157.61194 251.966833l-11.674958 23.349917-23.349917 11.674958 11.674958-23.349917 23.349917-11.674958zM671.310116 251.966833l52.537314 29.187396-17.512438-5.837479q-44.364842-3.502488-35.024876-23.349917zM215.986733 263.641791l40.862355 29.187396q-11.674959 58.374793 23.349917 70.049752l-17.512438-5.83748-17.512438-5.837479V286.991708h-17.512437l-11.674959-23.349917zM624.610282 263.641791l-11.674959 23.349917-17.512437 5.837479v81.72471l5.837479 17.512438q-37.359867-19.84743-17.512438-99.237148l40.862355-29.187396zM99.237148 286.991708l17.512437 99.237148-23.349917-11.674959 5.83748-87.562189zM321.06136 380.391376l40.862355 29.187397-17.512438-5.837479-23.349917-23.349918zM414.461028 380.391376l-11.674958 23.349918 11.674958-23.349918zM718.00995 380.391376l17.512438 5.83748-29.187396 17.512438 11.674958-23.349918zM239.33665 392.066335l40.862355 29.187396-17.512438-5.837479-23.349917-23.349917zM624.610282 392.066335l17.512438 17.512438v128.424544l-23.349917 11.674958 11.674958-11.674958v-128.424544l-5.837479-17.512438zM461.160862 403.741294l40.862355 29.187396q-11.674959 58.374793 23.349917 70.049751l-17.512437-5.837479H490.348259v-64.212272l-17.512438-5.837479-11.674959-23.349917zM297.711443 427.091211l52.537313 40.862355q-22.182421 63.044776 17.512438 52.537313l11.674959 23.349917-40.862355-29.187396q11.674959-52.537313-17.512438-64.212272l-23.349917-23.349917zM542.885572 508.81592l40.862355 29.187397-17.512438-5.83748-23.349917-23.349917zM461.160862 532.165837l40.862355 17.512438-17.512438-5.837479q-35.024876 5.837479-23.349917-11.674959zM402.78607 543.840796l11.674958 23.349917-11.674958-23.349917zM706.334992 543.840796l29.187396 17.512438-17.512438 5.837479-11.674958-23.349917zM110.912106 555.515755L105.074627 573.028192 99.237148 660.590381 93.399668 573.028192 110.912106 555.515755zM239.33665 555.515755q38.527363 21.014925 17.512438 99.237147L192.636816 695.615257l11.674958-23.349917 40.862355-11.674959q8.172471-80.557214-5.837479-105.074626zM542.885572 567.190713l52.537314 40.862355q-22.182421 63.044776 17.512437 52.537313l11.674959 23.349918-40.862355-29.187397q11.674959-52.537313-17.512438-64.212272l-23.349917-23.349917zM122.587065 660.590381l40.862355 29.187397-17.512438-5.837479-23.349917-23.349918zM694.660033 672.26534l-11.674958 23.349917-17.512438-5.837479 29.187396-17.512438z" fill="#E20419" opacity=".263"></path><path d="M157.61194 263.641791h35.024876l52.537313 40.862355Q233.499171 357.041459 262.686567 368.716418l105.074627 58.374793q16.344942-30.354892 70.049751-23.349917l52.537314 40.862354Q478.6733 497.140962 507.860697 508.81592l105.074626 58.374793 29.187397-11.674958V397.903814l-17.512438-5.837479-29.187396-11.674959q-19.84743-82.892206 29.187396-105.074626l46.699834-11.674959 52.537314 23.349917v87.562189L706.334992 392.066335 677.147595 409.578773v128.424544l17.512438 17.512438 29.187397 17.512437v81.72471l-17.512438 5.837479-58.374793 23.349918-52.537313-40.862355q22.182421-63.044776-17.512438-52.537314l-116.749586-70.049751q-8.172471 32.689884-58.374792 23.349917L350.248756 502.978441q11.674959-52.537313-17.512438-64.212272l-105.074626-58.374793-29.187397 11.674959v157.61194l17.512438 5.83748 29.187396 11.674958v75.887231L227.661692 660.590381q-16.344942 30.354892-70.049752 23.349918L105.074627 643.077944q-14.00995-72.384743 29.187396-87.562189l29.187397-17.512438v-128.424544L145.936982 392.066335 105.074627 362.878939q-14.00995-60.709784 17.512438-75.887231l35.024875-23.349917z" fill="#E1051B" opacity=".996"></path></svg>',
  zhihu: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M564.7 230.1V803h60l25.2 71.4L756.3 803h131.5V230.1H564.7zm247.7 497h-59.9l-75.1 50.4-17.8-50.4h-18V308.3h170.7v418.8zM526.1 486.9H393.3c2.1-44.9 4.3-104.3 6.6-172.9h130.9l-.1-8.1c0-.6-.2-14.7-2.3-29.1-2.1-15-6.6-34.9-21-34.9H287.8c4.4-20.6 15.7-69.7 29.4-93.8l6.4-11.2-12.9-.7c-.8 0-19.6-.9-41.4 10.6-35.7 19-51.7 56.4-58.7 84.4-18.4 73.1-44.6 123.9-55.7 145.6-3.3 6.4-5.3 10.2-6.2 12.8-1.8 4.9-.8 9.8 2.8 13 10.5 9.5 38.2-2.9 38.5-3 .6-.3 1.3-.6 2.2-1 13.9-6.3 55.1-25 69.8-84.5h56.7c.7 32.2 3.1 138.4 2.9 172.9h-141l-2.1 1.5c-23.1 16.9-30.5 63.2-30.8 65.2l-1.4 9.2h167c-12.3 78.3-26.5 113.4-34 127.4-3.7 7-7.3 14-10.7 20.8-21.3 42.2-43.4 85.8-126.3 153.6-3.6 2.8-7 8-4.8 13.7 2.4 6.3 9.3 9.1 24.6 9.1 5.4 0 11.8-.3 19.4-1 49.9-4.4 100.8-18 135.1-87.6 17-35.1 31.7-71.7 43.9-108.9L497 850l5-12c.8-1.9 19-46.3 5.1-95.9l-.5-1.8-108.1-123-22 16.6c6.4-26.1 10.6-49.9 12.5-71.1h158.7v-8c0-40.1-18.5-63.9-19.2-64.9l-2.4-3z" fill="#1296DB"></path></svg>',
  weibo: '<svg viewBox="0 0 1138 1024" xmlns="http://www.w3.org/2000/svg"><path d="M914.432 518.144q27.648 21.504 38.912 51.712t9.216 62.976-14.336 65.536-31.744 59.392q-34.816 48.128-78.848 81.92t-91.136 56.32-94.72 35.328-89.6 18.944-75.264 7.68-51.712 1.536-49.152-2.56-68.096-10.24-78.336-21.504-79.872-36.352-74.24-55.296-59.904-78.848q-16.384-29.696-22.016-63.488t-5.632-86.016q0-22.528 7.68-51.2t27.136-63.488 53.248-75.776 86.016-90.112q51.2-48.128 105.984-85.504t117.248-57.856q28.672-10.24 63.488-11.264t57.344 11.264q10.24 11.264 19.456 23.04t12.288 29.184q3.072 14.336.512 27.648t-5.632 26.624-5.12 25.6 2.048 22.528q17.408 2.048 33.792-1.536t31.744-9.216 31.232-11.776 33.28-9.216q27.648-5.12 54.784-4.608t49.152 7.68 36.352 22.016 17.408 38.4q2.048 14.336-2.048 26.624t-8.704 23.04-7.168 22.016 1.536 23.552q3.072 7.168 14.848 13.312t27.136 12.288 32.256 13.312 29.184 16.384zM656.384 836.608q26.624-16.384 53.76-45.056t44.032-64 18.944-75.776-20.48-81.408q-19.456-33.792-47.616-57.344t-62.976-37.376-74.24-19.968-80.384-6.144q-78.848 0-139.776 16.384t-105.472 43.008-72.192 60.416-38.912 68.608q-11.264 33.792-6.656 67.072t20.992 62.976 42.496 53.248 57.856 37.888q58.368 25.6 119.296 32.256t116.224.512 100.864-21.504 74.24-33.792zM522.24 513.024q20.48 8.192 38.912 18.432t32.768 27.648q10.24 12.288 17.92 30.72t10.752 39.424 1.536 42.496-9.728 38.912q-8.192 18.432-19.968 37.376t-28.672 35.328-40.448 29.184-57.344 18.944q-61.44 11.264-117.76-11.264t-88.064-74.752q-12.288-39.936-13.312-70.656t16.384-66.56q13.312-27.648 40.448-51.712t62.464-38.912 75.264-17.408 78.848 12.8zM359.424 764.928q37.888 3.072 57.856-18.432t21.504-48.128-15.36-47.616-52.736-16.896q-27.648 3.072-43.008 23.552t-17.408 43.52 9.728 42.496 39.424 21.504zM778.24 6.144q74.752 0 139.776 19.968t113.664 57.856 76.288 92.16 27.648 122.88q0 33.792-16.384 50.688t-35.328 17.408-35.328-14.336-16.384-45.568q0-40.96-22.528-77.824t-59.392-64.512-84.48-43.52-96.768-15.872q-31.744 0-47.104-15.36t-14.336-34.304 18.944-34.304 51.712-15.36zM778.24 169.984q95.232 0 144.384 48.64t49.152 146.944q0 30.72-10.24 43.52t-22.528 11.264-22.528-14.848-10.24-35.84q0-60.416-34.816-96.256t-93.184-35.84q-19.456 0-28.672-10.752t-9.216-23.04 9.728-23.04 28.16-10.752z"></path></svg>',
  nowcoder: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M839.339 413.867a298.41 298.41 0 0 0 95.701 16.298 302.336 302.336 0 0 0 53.035-5.034 315.477 315.477 0 0 1-212.736 129.536v42.666A165.803 165.803 0 0 0 818.005 768 170.667 170.667 0 0 1 647.34 938.667h-256a170.667 170.667 0 0 1-119.894-292.011 168.448 168.448 0 0 1-8.106-49.323v-45.44A340.864 340.864 0 0 1 35.968 421.59a344.661 344.661 0 0 0 56.704 5.078 337.408 337.408 0 0 0 100.096-15.659 170.453 170.453 0 0 1 70.57-325.675h85.334a85.333 85.333 0 0 0 0 170.667h341.333a85.333 85.333 0 0 0 0-170.667h85.334a170.667 170.667 0 0 1 64 328.534z m-192 396.8A42.667 42.667 0 0 0 690.005 768a41.813 41.813 0 0 0-5.93-20.437A168.79 168.79 0 0 1 604.672 768a42.667 42.667 0 0 0 42.667 42.667zM370.005 469.333a46.208 46.208 0 1 0 64 42.667 56.704 56.704 0 0 0-64-42.667z m-15.402 278.23A41.344 41.344 0 0 0 348.672 768a42.667 42.667 0 0 0 85.333 0 168.661 168.661 0 0 1-79.402-20.437z m314.069-278.23a46.208 46.208 0 1 0 64 42.667 56.704 56.704 0 0 0-64-42.667z"></path></svg>',
  jd: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M227.1 396.6c1.4 18.1 3.4 36.3 4.1 54.5 1.3 33.8-12.1 60.7-39.6 80.4-21.2 15.2-44.4 26.2-69.7 32.2-29.6 6.9-54.3-17.4-46.6-46.9 4.4-16.8 10-33.9 18.8-48.7 21.8-36.7 35.1-76.4 46-117.2 2-7.6 4.7-15.2 8.1-22.3 5.9-12.3 19.4-18.7 32.3-14.8 9.3 2.8 18.4 6.8 27.1 11.4 13.8 7.2 27.2 15.4 40.8 23.2 8.3-8.9 16.3-18.3 24.9-26.9 30.3-30.1 67.7-49.2 105.8-66.8 59.7-27.6 121.1-51 185.7-64.4 29.9-6.2 60.5-10.2 91-12.5 36.4-2.7 73-4.1 109.4-3.2 47.3 1.1 93.9 7.4 137.1 29.1 23.3 11.7 42.8 27.9 47 54.5 2.9 18.6 1.8 38.3-.3 57.2-3.5 32.1-16.6 61.7-29.4 90.9-3.4 7.7-12.3 13.9-20 18.4-19.5 11.4-41.3 17.3-63.4 21.5-62.3 11.9-123.4 6.6-183-14.8-35.4-12.7-63.9-35.8-89.9-62.3-2.7-2.7-4.9-6.4-8.2-8-3.5-1.7-9.1-3.1-11.6-1.4-2.6 1.8-4.1 7.7-3.4 11.2.9 4.2 4.1 8.4 7.2 11.7 37.7 40.8 83.6 68.1 137.7 80.6 64.6 14.9 128.9 14.1 192.3-6.9 3.6-1.2 7.2-2.6 10.7-4.2 3.4-1.5 6.8-3.4 11.5-4.2-7 10.2-13.6 20.6-20.9 30.5-49.2 66-112.3 112.4-191.9 135.6-50.8 14.8-101.6 12.7-152.1.4-84.4-20.6-161.9-56-228.7-112.6-20.8-17.6-40.4-36.6-54.1-60.5-5.3-9.2-9.8-19.2-12.3-29.3-2.1-8.1-5.4-13.3-12.4-15.4zM841.5 195c-9.8.9-19.7 1.3-29.4 2.8-15 2.4-29.3 7.3-41.2 17.1-10.5 8.6-9.3 21 2.4 27.6 4.7 2.6 10 4.5 15.2 5.9 23.7 6.5 47.9 4.8 71.9 2.1 12.3-1.4 24.5-5.3 36.1-9.8 8-3.1 14-9.9 13.6-19.7-.4-9.3-8-12.7-14.8-15.9-17-7.8-35.2-10-53.8-10.1zM559.8 304.5c14.2 0 25.3-10 25.3-22.6-.1-12.5-11.7-22.9-25.4-22.8-14.3.1-25 9.9-25.1 22.8 0 12.6 11 22.5 25.2 22.6zM669.9 849.2c-6.6 0-12.9.4-19.1-.2-1.7-.2-4-3.1-4.5-5.2-4.6-18-8.5-36.3-13.5-54.2-1.9-7-5.5-13.8-9.6-19.9-6.2-9.3-16.6-10.5-23.6-1.8-6.8 8.4-12.8 17.9-17 27.9-6.1 14.6-10.5 29.9-14.8 45.2-1.8 6.3-4 9.6-11 8.5-3.9-.6-8.1-.1-13-.1 1-26.2 1.9-51.6 2.9-79.3-6.2 3.1-10.9 4.6-14.5 7.4-8.3 6.7-16.5 13.6-24 21.2-13.6 13.9-26.8 28.3-40 42.7-8.3 9-11.2 9.9-25.5 6.6 16.9-28.7 33.7-57.1 51-86.2-16.6-4.8-31.1-11.4-37.3-28.4-3.9-10.6-3.3-21.1 1-32 1 3.7 1.8 7.5 2.9 11.2 5.6 19.1 22.4 29 41.3 23.3 4.9-1.5 10.3-5.6 13-9.9 16.6-26.8 32.6-54 48.4-81.2 2.9-5 5.8-5.9 11.2-5 26 4.1 52.1 8 78.3 1.1 5.7-1.5 11.2-3.9 17.3-6.1.1 71.1.1 142.1.1 214.4z"></path></svg>',
  r2: '<svg viewBox="0 0 1280 1024" xmlns="http://www.w3.org/2000/svg"><path d="M796.82375 631.836875l-432.75-5.49a8.5875 8.5875 0 0 1-6.81-3.61125 8.715 8.715 0 0 1-.92625-7.775625 11.518125 11.518125 0 0 1 10.051875-7.6425l436.7625-5.505c51.808125-2.3625 107.89875-44.20125 127.54125-95.22l24.91125-64.76625a14.895 14.895 0 0 0 .9825-5.505 14.503125 14.503125 0 0 0-.3075-3.058125A284.83125 284.83125 0 0 0 409.356875 404 127.725 127.725 0 0 0 208.625 537.48125C110.6075 540.32375 32 620.24 32 718.475a180.10125 180.10125 0 0 0 1.929375 26.17125 8.4525 8.4525 0 0 0 8.334375 7.258125l798.9375.095625c.080625 0 .15-.035625.22875-.0375a10.51125 10.51125 0 0 0 9.883125-7.5l6.136875-21.121875c7.3125-25.125 4.59-48.375-7.6875-65.4375-11.28-15.735-30.09375-24.99-52.93875-26.06625zm198.65625-185.274375c-4.014375 0-8.008125.11625-11.983125.3075a7.070625 7.070625 0 0 0-6.2325 4.974375l-17.019375 58.486875c-7.3125 25.125-4.591875 48.34875 7.6875 65.41875 11.2875 15.75 30.10125 24.980625 52.94625 26.0625l92.25 5.510625a8.420625 8.420625 0 0 1 6.58125 3.55125 8.7 8.7 0 0 1 .96375 7.816875 11.536875 11.536875 0 0 1-10.033125 7.640625l-95.859375 5.510625c-52.03875 2.38125-108.129375 44.20125-127.771875 95.22l-6.928125 18.01125a5.0925 5.0925 0 0 0 4.550625 6.9c.08625 0 .165.031875.255.031875h329.83125a8.79375 8.79375 0 0 0 8.510625-6.31875 234.013125 234.013125 0 0 0 8.77875-63.75C1232 551.9375 1126.1075 446.5625 995.48 446.5625z"></path></svg>',
  tcl: '<svg viewBox="0 0 1705 1024" xmlns="http://www.w3.org/2000/svg"><path d="M0 1021.912997V240.244838c.75269-3.044972 1.744871-6.05573 2.189642-9.169128 1.026395-6.842633 1.436953-13.685266 2.668627-20.527898a251.261477 251.261477 0 0 1 98.602339-159.80969A245.171534 245.171534 0 0 1 224.712061 2.360708c5.131975-.615837 10.263949-1.40274 15.395924-2.087003h1463.912864v1017.39686c0 1.505379-.273705 2.839693-.478985 4.789843h-1696.972937c-2.121216-.307918-4.345072-.547411-6.568927-.547411zm969.053659-475.56298l-1.197461 5.542532c-5.816238 26.959973-21.314801 45.366656-47.89843 53.817307a123.37267 123.37267 0 0 1-49.643301 4.447712 90.904377 90.904377 0 0 1-78.484998-65.005012 136.202606 136.202606 0 0 1-4.721417-42.49275 104.897561 104.897561 0 0 1 6.842633-37.052856c11.427197-28.841697 31.784029-48.206348 62.06268-56.00695a122.277848 122.277848 0 0 1 53.133043-.923755 74.961042 74.961042 0 0 1 32.091948 13.514199c14.095824 10.606081 21.554293 25.249315 25.420381 42.047979.513197 2.292282 1.094821 4.584564 1.608019 6.842633h107.839893a54.022586 54.022586 0 0 0 0-5.850451c-.547411-4.789843-1.129034-9.579686-1.950151-14.369529a135.244637 135.244637 0 0 0-32.707784-68.426328 175.376679 175.376679 0 0 0-68.836886-46.187772 221.119679 221.119679 0 0 0-67.947344-13.924757 362.659539 362.659539 0 0 0-48.514267.513197 231.965252 231.965252 0 0 0-68.426328 14.369529c-65.005012 25.659873-100.894621 74.037287-111.500702 142.292549a220.640695 220.640695 0 0 0-1.060608 52.311928 165.694353 165.694353 0 0 0 22.649115 73.42145 174.213431 174.213431 0 0 0 94.873104 76.432209 267.923288 267.923288 0 0 0 75.953224 13.685265 285.782559 285.782559 0 0 0 89.501637-9.134915 166.891814 166.891814 0 0 0 65.005012-33.426261c30.210224-25.728299 48.377414-57.9571 53.064617-97.507517a75.747945 75.747945 0 0 0 0-8.75857zm-457.430004 135.005145v-198.265286-22.341196-22.033277h134.83408v-97.84965c-5.782025-1.163248-387.737788-.992182-392.356566.273706v97.918075h135.415704v242.297628zm746.873371-93.949348v-246.334782c-6.842633-1.197461-112.903441-.957969-116.906381 0-1.129034 7.150551-.855329 336.041697.342131 340.181491h307.918477v-46.906248-23.436018c0-7.800601.376345-15.430137-.307919-23.436017z"></path><path d="M0 1021.912997c2.223856 0 4.447711.273705 6.842633.273705h1696.972937c.205279-1.95015.410558-3.421316.478984-4.789843s0-2.976545 0-4.481924V6.842633v-6.842633c.376345.171066 1.060608.342132 1.060608.547411v1023.452589H0z" fill="#FFFFFF"></path></svg>'
};

// 去品牌化：不再使用各渠道的品牌色，统一由 CSS 控制样式

// 判断状态类型
const isStatusSuccess = (status: string | undefined): boolean => {
  if (!status) return false;
  return status.includes('✓') || status.includes('完成');
};

const isStatusError = (status: string | undefined): boolean => {
  if (!status) return false;
  return status.includes('✗') || status.includes('失败');
};

const isStatusUploading = (status: string | undefined): boolean => {
  if (!status) return false;
  return status.includes('%') || status.includes('中');
};

// 统计各状态数量
const getStatusCounts = (item: QueueItem) => {
  let success = 0, error = 0, uploading = 0, pending = 0;
  item.enabledServices?.forEach(serviceId => {
    const status = item.serviceProgress?.[serviceId]?.status || '';
    if (isStatusSuccess(status)) success++;
    else if (isStatusError(status)) error++;
    else if (isStatusUploading(status)) uploading++;
    else pending++;
  });
  return { success, error, uploading, pending };
};

// 判断少渠道模式 (≤4)
const isFewChannels = (item: QueueItem): boolean => {
  return (item.enabledServices?.length || 0) <= 4;
};

// 计算堆叠进度条百分比
const getStackedProgress = (item: QueueItem) => {
  const counts = getStatusCounts(item);
  const total = item.enabledServices?.length || 1;
  return {
    successPct: (counts.success / total) * 100,
    errorPct: (counts.error / total) * 100,
    uploadingPct: (counts.uploading / total) * 100
  };
};

// 获取状态描述文本
const getStatusText = (item: QueueItem): string => {
  const counts = getStatusCounts(item);
  if (counts.uploading > 0) return '正在同步...';
  if (counts.error > 0 && counts.success > 0) return '上传完成，部分失败';
  if (counts.error > 0) return '上传失败';
  if (counts.success > 0) return '全部完成';
  return '等待中...';
};

// 获取渠道卡片的状态类
const getChannelCardClass = (item: QueueItem, service: ServiceType) => {
  const status = item.serviceProgress?.[service]?.status || '';
  return {
    'error': isStatusError(status),
    'success': isStatusSuccess(status)
  };
};

// 获取渠道状态标签文本（紧凑模式）
const getStatusLabel = (item: QueueItem, service: ServiceType): string => {
  const progress = item.serviceProgress?.[service];
  const status = progress?.status || '';

  if (isStatusSuccess(status)) return '已发布';
  if (isStatusError(status)) return '失败';
  if (isStatusUploading(status)) return '上传中...';
  return '等待中';
};

// 获取状态标签的样式类
const getStatusLabelClass = (item: QueueItem, service: ServiceType): string => {
  const status = item.serviceProgress?.[service]?.status || '';
  if (isStatusSuccess(status)) return 'success';
  if (isStatusError(status)) return 'error';
  if (isStatusUploading(status)) return 'uploading';
  return '';
};

// 复制链接
const copyToClipboard = async (text: string | undefined) => {
  if (!text) return;
  try {
    await writeText(text);
    toast.success('已复制', '链接已复制到剪贴板', 1500);
  } catch (err) {
    console.error('Copy failed', err);
    toast.error('复制失败', String(err));
  }
};

defineExpose({
  addFile: (item: QueueItem) => {
    queueItems.value.unshift(deepClone(item));
  },
  updateItem: (id: string, updates: Partial<QueueItem>) => {
    const index = queueItems.value.findIndex(i => i.id === id);
    if (index !== -1) {
      const item = queueItems.value[index];
      const mergedItem = deepMerge(item, updates);
      queueItems.value[index] = mergedItem;

      const updatedItem = queueItems.value[index];
      if (updatedItem.weiboPid && !updatedItem.thumbUrl) {
        const baiduPrefix = 'https://image.baidu.com/search/down?thumburl=';
        const bmiddleUrl = `https://tvax1.sinaimg.cn/bmiddle/${updatedItem.weiboPid}.jpg`;
        queueItems.value[index].thumbUrl = `${baiduPrefix}${bmiddleUrl}`;
      }
    }
  },
  getItem: (id: string) => queueItems.value.find(i => i.id === id),
  clear: () => {
    queueItems.value = [];
  },
  count: () => queueItems.value.length,
  getAllItems: () => queueItems.value,
  setRetryCallback: (callback: (itemId: string, serviceId?: ServiceType) => void) => {
    retryCallback = callback;
  }
});
</script>

<template>
  <div class="upload-queue">
    <!-- 空状态提示 -->
    <div v-if="queueItems.length === 0" class="upload-queue-empty">
      <i class="pi pi-inbox empty-icon"></i>
      <span class="empty-text">暂无上传队列</span>
    </div>

    <!-- 队列卡片列表 -->
    <div
      v-for="item in queueItems"
      :key="item.id"
      class="queue-card"
    >
      <!-- 头部：缩略图 + 文件名 + 统计标签 + 堆叠进度条 -->
      <div class="card-header">
        <!-- 缩略图 -->
        <div class="thumbnail-wrapper">
          <img
            v-if="item.thumbUrl"
            :src="item.thumbUrl"
            :alt="item.fileName"
            class="thumbnail"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'"
          />
          <div v-else class="thumbnail-placeholder">
            <i class="pi pi-image"></i>
          </div>
        </div>

        <!-- 头部内容 -->
        <div class="header-content">
          <!-- 顶部行：文件名 + 状态标签 -->
          <div class="header-top">
            <h3 class="filename" :title="item.fileName">{{ item.fileName }}</h3>
            <div class="status-pills">
              <span v-if="getStatusCounts(item).success > 0" class="pill success">
                <i class="pi pi-check-circle"></i>
                {{ getStatusCounts(item).success }}
              </span>
              <span v-if="getStatusCounts(item).error > 0" class="pill error">
                <i class="pi pi-exclamation-circle"></i>
                {{ getStatusCounts(item).error }}
              </span>
              <span v-if="getStatusCounts(item).uploading > 0" class="pill uploading">
                <i class="pi pi-spin pi-spinner"></i>
                {{ getStatusCounts(item).uploading }}
              </span>
            </div>
          </div>

          <!-- 堆叠进度条 -->
          <div class="stacked-progress">
            <div
              class="segment success"
              :style="{ width: getStackedProgress(item).successPct + '%' }"
            ></div>
            <div
              class="segment error"
              :style="{ width: getStackedProgress(item).errorPct + '%' }"
            ></div>
            <div
              class="segment uploading"
              :style="{ width: getStackedProgress(item).uploadingPct + '%' }"
            ></div>
          </div>

          <!-- 状态描述 -->
          <div class="status-line">
            <span class="status-text">{{ getStatusText(item) }}</span>
          </div>
        </div>
      </div>

      <!-- 自适应网格 -->
      <div
        v-if="item.enabledServices && item.serviceProgress"
        class="channel-grid"
        :class="{ 'few-channels': isFewChannels(item) }"
      >
        <div
          v-for="service in item.enabledServices"
          :key="service"
          class="channel-card"
          :class="getChannelCardClass(item, service)"
        >
          <!-- 渠道图标（去品牌化：统一中性灰） -->
          <div class="channel-icon" :class="{ 'has-svg': !!serviceIcons[service] }">
            <span v-if="serviceIcons[service]" class="icon-svg" v-html="serviceIcons[service]"></span>
            <span v-else>{{ serviceNames[service][0] }}</span>
          </div>

          <!-- 渠道信息 -->
          <div class="channel-info">
            <span class="channel-name">{{ serviceNames[service] }}</span>

            <!-- 少渠道模式：显示进度条 -->
            <template v-if="isFewChannels(item)">
              <ProgressBar
                :value="item.serviceProgress[service]?.progress || 0"
                :showValue="false"
                class="channel-progress"
                :class="getStatusLabelClass(item, service)"
              />
              <span class="channel-status" :class="getStatusLabelClass(item, service)">
                {{ getStatusLabel(item, service) }}
              </span>
            </template>

            <!-- 多渠道模式：显示状态标签 -->
            <span v-else class="status-label" :class="getStatusLabelClass(item, service)">
              {{ getStatusLabel(item, service) }}
            </span>
          </div>

          <!-- 右上角：成功时复制按钮 或 失败时重试按钮 -->
          <button
            v-if="isStatusSuccess(item.serviceProgress[service]?.status)"
            @click="copyToClipboard(item.serviceProgress[service]?.link)"
            class="copy-btn"
            title="复制链接"
          >
            <i class="pi pi-copy"></i>
          </button>
          <button
            v-else-if="isStatusError(item.serviceProgress[service]?.status)"
            @click="handleRetry(item.id, service)"
            class="retry-btn"
            title="重试"
          >
            <i class="pi pi-refresh"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 队列容器 */
.upload-queue {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 空状态 */
.upload-queue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  text-align: center;
  gap: 8px;
}

.empty-icon {
  font-size: 2rem;
  color: var(--text-muted);
  opacity: 0.5;
}

.empty-text {
  color: var(--text-secondary);
  font-size: 13px;
  font-style: italic;
  opacity: 0.7;
}

/* 队列卡片 */
.queue-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px;
}

/* 卡片头部 */
.card-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

/* 缩略图 */
.thumbnail-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
}

.thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 16px;
}

/* 头部内容 */
.header-content {
  flex: 1;
  min-width: 0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
}

.filename {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* 状态标签 */
.status-pills {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid transparent;
}

.pill i {
  font-size: 10px;
}

/* 状态胶囊：更克制的颜色 */
.pill.success {
  color: var(--success);
  background: rgba(16, 185, 129, 0.05);
  border-color: transparent;
}

.pill.error {
  color: var(--error);
  background: transparent;
  border-color: transparent;
}

.pill.uploading {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
  border-color: transparent;
}

/* 堆叠进度条：更细更精致 */
.stacked-progress {
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  display: flex;
  overflow: hidden;
  margin-bottom: 4px;
}

.segment {
  height: 100%;
  transition: width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.segment.success {
  background: var(--success);  /* Emerald */
}

.segment.error {
  background: #f87171;  /* Rose 400 - 更柔和 */
}

.segment.uploading {
  background: var(--primary);  /* Sky */
  animation: progressPulse 1.5s ease-in-out infinite;
}

@keyframes progressPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* 状态描述 */
.status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-text {
  font-size: 11px;
  color: var(--text-muted);
}

/* 自适应网格 */
.channel-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(4, 1fr);
}

.channel-grid.few-channels {
  grid-template-columns: repeat(2, 1fr);
}

/* 渠道卡片 */
.channel-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: all 0.2s ease;
}

/* Hover 态：边框变品牌蓝 */
.channel-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

/* 错误态：克制的红色边框，不用红色背景 */
.channel-card.error {
  background: var(--bg-card);
  border-color: rgba(239, 68, 68, 0.3);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.05);
}

/* 成功态：与默认态相同 */
.channel-card.success {
  background: var(--bg-card);
}

/* 少渠道模式卡片 */
.few-channels .channel-card {
  padding: 10px;
}

/* 渠道图标（去品牌化：统一中性灰，Hover 变蓝） */
.channel-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.channel-icon.has-svg {
  background: var(--bg-card);
  color: var(--text-primary);
}

.channel-icon .icon-svg {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.channel-icon .icon-svg svg {
  width: 18px;
  height: 18px;
}

/* Hover 时图标变品牌蓝 */
.channel-card:hover .channel-icon {
  background: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

/* 错误时图标变红 */
.channel-card.error .channel-icon {
  background: var(--error-soft);
  color: var(--error);
}

.few-channels .channel-icon {
  width: 32px;
  height: 32px;
  font-size: 12px;
}

/* 渠道信息 */
.channel-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.channel-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.few-channels .channel-name {
  font-size: 13px;
}

/* 状态标签（紧凑模式） */
.status-label {
  font-size: 11px;
  color: var(--text-muted);
}

.status-label.success {
  color: var(--success);
}

.status-label.error {
  color: var(--error);
}

.status-label.uploading {
  color: var(--primary);
}

/* 渠道进度条（宽版模式） */
.channel-progress {
  height: 4px !important;
  border-radius: 2px;
  margin-top: 2px;
}

.channel-progress :deep(.p-progressbar) {
  background: var(--bg-input);
  border-radius: 2px;
}

.channel-progress :deep(.p-progressbar-value) {
  border-radius: 2px;
  background: var(--primary);
  transition: width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.channel-progress.success :deep(.p-progressbar-value) {
  background: var(--success);
}

.channel-progress.error :deep(.p-progressbar-value) {
  background: var(--error);
}

.channel-progress.uploading :deep(.p-progressbar-value) {
  background: var(--primary);
  animation: progressShimmer 1.5s ease-in-out infinite;
  background-size: 200% 100%;
  background-image: linear-gradient(
    90deg,
    var(--primary) 0%,
    var(--accent) 50%,
    var(--primary) 100%
  );
}

@keyframes progressShimmer {
  0%, 100% { background-position: 200% 0; }
  50% { background-position: 0% 0; }
}

/* 渠道状态文本（宽版模式） */
.channel-status {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
}

.channel-status.success {
  color: var(--success);
}

.channel-status.error {
  color: var(--error);
}

.channel-status.uploading {
  color: var(--primary);
}

/* 复制按钮 */
.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--success);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.copy-btn:hover {
  background: var(--success-soft);
  opacity: 1;
}

.copy-btn i {
  font-size: 12px;
}

.few-channels .copy-btn {
  position: static;
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 4px;
  opacity: 1;
}

.few-channels .copy-btn:hover {
  background: rgba(16, 185, 129, 0.15);
}

/* 重试按钮 */
.retry-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--error-soft);
}

.retry-btn i {
  font-size: 12px;
}

.few-channels .retry-btn {
  position: static;
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--error-soft);
}

.few-channels .retry-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}
</style>
