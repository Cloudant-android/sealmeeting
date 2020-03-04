(function (RongMeeting, dependencies, components) {
  'use strict';
  var win = dependencies.win;

  var common = RongMeeting.common,
    utils = RongMeeting.utils,
    emitter = utils.EventEmitter,
    dataModel = RongMeeting.dataModel,
    server = dataModel.server,
    dialog = RongMeeting.dialog;

  var resolutionSetting = RongMeeting.setting.rtc.resolution;

  var ENUM = RongMeeting.ENUM,
    Event = ENUM.Event,
    RoleENUM = ENUM.Role,
    SpecialErrorCode = ENUM.SpecialErrorCode;

  var loading, confirmDialog;

  function toast(content) {
    common.toast(content);
  }

  function destoryLoading() {
    loading && loading.destroy();
  }

  function createLoading(text) {
    destoryLoading();
    loading = dialog.loading({
      content: text
    });
  }

  function toLoginPage() {
    // var instance = RongMeeting.instance;
    // instance.$router.push({ name: 'login', params: { force: true } });
    win.location.href = '../scxt';
  }

  function hungup(isJump) {
    createLoading('正在退出 ...');
    server.logout().then(function () {
      destoryLoading();
      isJump && toLoginPage();
    }).catch(function (err) {
      destoryLoading();
      common.console.log({'退出失败': err});
      toLoginPage();
    });
  }

  function confirmHungup(text) {
    var isConnected = RongMeeting.instance.auth;
    confirmDialog && confirmDialog.destroy();
    hungup();
    if (isConnected) {
      confirmDialog = dialog.confirm({
        content: text,
        confirmed: toLoginPage,
        canceled: toLoginPage
      });
    }
  }

  function hungupWhenBeforeUnload(context) {
    context.beforeunload = function () {
      hungup(true);
    };
    win.addEventListener('beforeunload', context.beforeunload);
  }

  function hungupWhenKickByOther() {
    emitter.on(Event.KICKED_OFFLINE_BY_OTHER_CLIENT, function () {
      confirmHungup('您已在其他设备登录');
    });
  }

  function hungupWhenRTCError() {
    emitter.on(Event.RTC_ERRORED, function () {
      confirmHungup('网络已断开, 请重新进入房间');
    });
  }

  function reconnectWhenNetworkUnavailable() {
    var chatServer = RongMeeting.dataModel.chat;
    emitter.on(Event.NETWORK_UNAVAILABLE, function () {
      createLoading('网络已断开, 正在重连 ...');
      var onError = function (error) {
        destoryLoading();
        // confirmHungup('网络已断开, 请重新进入房间');
        common.console.error({ '重连失败': error });
      };
      chatServer.reconnect({
        onSuccess: function () {
          destoryLoading();
        },
        onTokenIncorrect: onError,
        onError: onError
      });
    });
  }

  function hungupWhenClassKicked() {
    emitter.on(Event.SELF_USER_KICKED, function () {
      dialog.confirm({ content: '您已被主持人踢出会议' });
      hungup(true);
    });
  }
  
  function toastWhenSelfRoleChanged() {
    emitter.on(Event.SELF_USER_ROLE_CHANGED, function (user) {
      var role = user.role;
      if (role === RoleENUM.AUDIENCE) {
        toast('你已被降级为列席，别人看/听不见你');
      }
    });
  }

  function toastWhenDeviceChanged() {
    emitter.on(Event.USER_CLAIM_MIC_CHANGE, function (/* enable */) {
      // !enable && toast('主持人关闭了你的麦克风');
    });
    emitter.on(Event.USER_CLAIM_CAMERA_CHANGE, function (/* enable */) {
      // !enable && toast('主持人关闭了你的摄像头');
    });
  }

  function toastMemberStatus() {
    var auth = RongMeeting.instance.auth,
      members = auth.members,
      role = auth.loginUser.role;
    if (role === RoleENUM.AUDIENCE) {
      toast('你当前身份是列席, 其它人看/听不见你');
    }
    if (members.length === 1) {
      toast('当前会议只有你一人, 你可以等待或离开');
    }
  }

  function initClass(context) {
    context.userList = server.getUserList();
    emitter.on(Event.USER_LIST_CHANGED, function (list) {
      context.userList = list.filter(function (user) {
        return !!user.role;
      });
    });

    toastMemberStatus();

    hungupWhenBeforeUnload(context);
    hungupWhenClassKicked();
    hungupWhenKickByOther();
    hungupWhenRTCError();
    toastWhenSelfRoleChanged();
    toastWhenDeviceChanged();
    reconnectWhenNetworkUnavailable();
  }

  function entryClass(isAudience, context) {
    var loadingText = isAudience ? '正在以列席身份加入会议 .....' : '正在加入会议 .....';
    createLoading(loadingText);
    var classParams = {
      roomId: context.meetingInfo.mId,
      userName: utils.generateName(),
      isAudience: !!isAudience,
      isVideoClosed: false,
      resolution: resolutionSetting.default
    };
    dataModel.server.init(classParams).then(function (data) {
      destoryLoading();
      initClass(context);
      context.classInfo = data;
    }).catch(function (error) {
      destoryLoading();
      if (error.errCode === SpecialErrorCode.ERR_OVER_MAX_COUNT) {
        return entryClass(true, context);
      }
      var errorText = context.locale.errorCode[error.errCode] || error.errDetail;
      dialog.confirm({
        content: errorText
      });
    });
  }

  function getMethods() {
    return {
      selectTab: function (tab) {
        this.selectedTab = tab;
      },
      hungup: hungup
    }
  }
  var tabList = [
    { name: '会议消息', tag: 'chat' },
    { name: '在线成员', tag: 'user-list' }
  ];

  components.class = function (resolve) {
    var options = {
      name: 'class',
      template: '#rong-template-class',
      data: function () {
        return {
          tabList: tabList,
          selectedTab: tabList[0],
          userList: [],
          classInfo: null
        };
      },
      computed: {
        loginUser: function () {
          return common.getLoginUser(this.userList);
        },
        assistant: function () {
          var role = RoleENUM.ASSISTANT;
          return common.getUserByRole(this.userList, role);
        },
        teacher: function () {
          var role = RoleENUM.TEACHER;
          return common.getUserByRole(this.userList, role);
        }
      },
      components: {
        'class-info': components.classInfo,
        'display': components.display,
        'rong-rtc': components.rtc,
        'chat': components.chat,
        'user-list': components.userList
      },
      methods: getMethods(),
      destroyed: function () {
        win.removeEventListener('beforeunload', this.beforeunload);
      },
      mounted: function () {
        var context = this;
        var routeParams = context.$route.params;
        if (routeParams.isLogined) {
          initClass(context);
          context.classInfo = routeParams || {};
        } else {
          entryClass(false, context);
        }
      }
    };
    common.component(options, resolve);
  };

})(window.RongMeeting, {
  Vue: window.Vue,
  win: window
}, window.RongMeeting.components);