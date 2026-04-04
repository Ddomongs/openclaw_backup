export const CONFIG = {
  cdpUrl: process.env.CSBOT_CDP_URL || 'http://127.0.0.1:9223',
  smartstoreQaUrl: process.env.CSBOT_SMARTSTORE_QA_URL || 'https://sell.smartstore.naver.com/#/comment/',
  quickstarBaseUrl: process.env.CSBOT_QUICKSTAR_BASE_URL || 'https://quickstar.co.kr',
  quickstarMbId: process.env.CSBOT_QUICKSTAR_MB_ID || 'sos8457',
  quickstarPageblock: process.env.CSBOT_QUICKSTAR_PAGEBLOCK || '100',
  qnaMode: process.env.CSBOT_QNA_MODE || 'assist',
  assistReportPath: process.env.CSBOT_ASSIST_REPORT_PATH || '/Users/dh/.openclaw/workspace/smartstore-cs-worker/runtime-data/qna-assist-latest.md',
  pollLimit: Number(process.env.CSBOT_POLL_LIMIT || 5),
  dryRun: (process.env.CSBOT_DRY_RUN || 'true').toLowerCase() !== 'false',
  timeouts: {
    short: 2000,
    medium: 5000,
    long: 15000,
  },
};
