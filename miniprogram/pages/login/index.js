const session = require('../../lib/session');
Page({
  data: {wechatEnabled:session.wechatEnabled, accounts:['sales-a','sales-b','supervisor','supervisor-2','market-a','market-manager','general-admin'], account:0, busy:false, message:''},
  changeAccount(event) { this.setData({account:Number(event.detail.value)}); },
  submit(event) {
    return this.enter(() => session.login(this.data.accounts[this.data.account], event.detail.value.passphrase || ''));
  },
  submitWeChat() {
    return this.enter(() => session.loginWithWeChat());
  },
  async enter(signIn) {
    if (this.data.busy) return;
    this.setData({busy:true,message:''});
    try {
      await signIn();
      wx.reLaunch({url:'/pages/workspace/index'});
    } catch (error) {
      if (!error.stale) this.setData({message:error.message});
    } finally {
      this.setData({busy:false});
    }
  },
});
