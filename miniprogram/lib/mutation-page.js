const session = require('./session');

async function run(page, path, body, staffAction) {
  if (page.data.saving || page.retryTask) return;
  page.retryTask = session.mutation(path, body, staffAction);
  await retry(page);
}
async function retry(page) {
  if (page.data.saving || !page.retryTask) return;
  page.setData({saving:true, retryable:false, message:''});
  const task = page.retryTask;
  try {
    const result = await task();
    if (page.retryTask !== task) return;
    page.retryTask = null;
    await page.afterMutation(result);
  } catch (error) {
    if (error.stale || page.retryTask !== task) return;
    if (!error.retryable) page.retryTask = null;
    page.setData({retryable:!!error.retryable, conflict:error.status === 409,
      message:error.status === 409 ? error.message + '。请刷新并核对最新记录。' : error.message});
  } finally {
    page.setData({saving:false});
  }
}
module.exports = {run, retry};
