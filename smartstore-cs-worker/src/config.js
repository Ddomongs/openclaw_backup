export const CONFIG = {
  cdpUrl: process.env.CSBOT_CDP_URL || 'http://127.0.0.1:9222',
  smartstoreQaUrl: process.env.CSBOT_SMARTSTORE_QA_URL || 'https://sell.smartstore.naver.com/#/comment/',
  pollLimit: Number(process.env.CSBOT_POLL_LIMIT || 5),
  dryRun: (process.env.CSBOT_DRY_RUN || 'true').toLowerCase() !== 'false',
  timeouts: {
    short: 2000,
    medium: 5000,
    long: 15000,
  },
};
