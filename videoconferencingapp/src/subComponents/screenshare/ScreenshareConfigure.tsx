/*
********************************************
 Copyright © 2022 Agora Lab, Inc., all rights reserved.
 AppBuilder and all associated components, source code, APIs, services, and documentation
 (the “Materials”) are owned by Agora Lab, Inc. and its licensors. The Materials may not be
 accessed, used, modified, or distributed for any purpose without a license from Agora Lab, Inc.
 Use without a license or in violation of any license terms and conditions (including use for
 any purpose competitive to Agora Lab, Inc.’s business) is strictly prohibited. For more
 information visit https://appbuilder.agora.io.
*********************************************
*/
import React, {useContext, useEffect, useRef, useState} from 'react';
import {DispatchContext, PropsContext, UidType} from '../../../agora-rn-uikit';
import {ScreenshareContext} from './useScreenshare';
import {
  getGridLayoutName,
  getPinnedLayoutName,
  useChangeDefaultLayout,
  useSetPinnedLayout,
} from '../../pages/video-call/DefaultLayouts';
import {useScreenContext} from '../../components/contexts/ScreenShareContext';
import events, {PersistanceLevel} from '../../rtm-events-api';
import {EventActions, EventNames} from '../../rtm-events';
import {IAgoraRTC} from 'agora-rtc-sdk-ng';
import {timeNow} from '../../rtm/utils';
import {
  controlMessageEnum,
  useLayout,
  useContent,
  useRtc,
} from 'customization-api';
import {filterObject} from '../../utils';
import Toast from '../../../react-native-toast-message';
import {useString} from '../../utils/useString';
import {
  videoRoomScreenShareErrorToastHeading,
  videoRoomScreenShareErrorToastSubHeading,
} from '../../language/default-labels/videoCallScreenLabels';
import {LogSource, logger} from '../../logger/AppBuilderLogger';

export const ScreenshareContextConsumer = ScreenshareContext.Consumer;

export const ScreenshareConfigure = (props: {children: React.ReactNode}) => {
  const toastHeading = useString(videoRoomScreenShareErrorToastHeading)();
  const toastSubHeading = useString(videoRoomScreenShareErrorToastSubHeading)();
  const [isScreenshareActive, setScreenshareActive] = useState(false);
  const {dispatch} = useContext(DispatchContext);
  const rtc = useRtc();
  const {defaultContent, activeUids, pinnedUid, secondaryPinnedUid} =
    useContent();
  const isPinned = useRef(0);
  const {setScreenShareData, screenShareData} = useScreenContext();
  const setPinnedLayout = useSetPinnedLayout();
  const changeLayout = useChangeDefaultLayout();
  const {currentLayout} = useLayout();
  const currentLayoutRef = useRef({currentLayout: currentLayout});

  const {channel, appId, screenShareUid, screenShareToken, encryption} =
    useContext(PropsContext).rtcProps;

  const defaultContentRef = useRef({defaultContent: defaultContent});
  const pinnedUidRef = useRef({pinnedUid: pinnedUid});
  const secondaryPinnedUidRef = useRef({
    secondaryPinnedUid: secondaryPinnedUid,
  });

  useEffect(() => {
    pinnedUidRef.current.pinnedUid = pinnedUid;
  }, [pinnedUid]);

  useEffect(() => {
    secondaryPinnedUidRef.current.secondaryPinnedUid = secondaryPinnedUid;
  }, [secondaryPinnedUid]);

  useEffect(() => {
    defaultContentRef.current.defaultContent = defaultContent;
  }, [defaultContent]);

  useEffect(() => {
    currentLayoutRef.current.currentLayout = currentLayout;
  }, [currentLayout]);

  /**
   * Event api callback trigger even before screenshare data available in the RTC layer.
   * so instead of calling triggerChangeLayout from the event api call back
   * listening for rtc layout lastJoinedUid data and if its screenshare then call triggerChangeLayout
   * lastJoinedUid will be coming from the user joined event
   * cross check lastJoinedUid data with renderlist
   */

  useEffect(() => {
    const data = filterObject(screenShareData, ([k, v]) => v?.isActive);
    if (data) {
      const recentScreenshare = Object.keys(data)
        .map(i => parseInt(i))
        .sort((a, b) => {
          return data[a].ts - data[b].ts;
        });
      if (recentScreenshare?.length) {
        recentScreenshare.reverse();
        if (
          isPinned.current !== recentScreenshare[0] &&
          activeUids.indexOf(recentScreenshare[0]) !== -1
        ) {
          triggerChangeLayout(
            true,
            recentScreenshare[0],
            defaultContentRef.current.defaultContent[recentScreenshare[0]]
              ?.parentUid,
          );
        }
      }
    }
  }, [activeUids, screenShareData]);

  const triggerChangeLayout = (
    pinned: boolean,
    screenShareUid?: UidType,
    parentUid?: UidType,
  ) => {
    let layout = currentLayoutRef.current.currentLayout;
    //screenshare is started set the layout to Pinned View
    if (pinned && screenShareUid) {
      isPinned.current = screenShareUid;
      dispatch({
        type: 'UserPin',
        value: [screenShareUid],
      });
      if (parentUid && !secondaryPinnedUidRef.current.secondaryPinnedUid) {
        dispatch({
          type: 'UserSecondaryPin',
          value: [parentUid],
        });
      } else if (
        parentUid &&
        secondaryPinnedUidRef.current.secondaryPinnedUid
      ) {
        dispatch({
          type: 'ActiveSpeaker',
          value: [parentUid],
        });
      }
      layout !== getPinnedLayoutName() && setPinnedLayout();
    } else {
      isPinned.current = 0;
      //screenshare is stopped set the layout Grid View
      layout !== getGridLayoutName() && changeLayout();
    }
  };

  useEffect(() => {
    const unsubKickScreenshare = events.on(
      controlMessageEnum.kickScreenshare,
      () => {
        //if screenscreen already active. then below method will stop the screen share
        // @ts-ignore
        rtc.RtcEngineUnsafe.startScreenshare();
      },
    );
    const unsubScreenshareAttribute = events.on(
      EventNames.SCREENSHARE_ATTRIBUTE,
      data => {
        const payload = JSON.parse(data.payload);
        const action = payload.action;
        const value = payload.value;

        if (data?.sender) {
          let screenUidOfUser =
            defaultContentRef.current.defaultContent[data?.sender]?.screenUid;
          if (!screenUidOfUser) {
            screenUidOfUser = payload?.screenUidOfUser;
          }
          if (screenUidOfUser) {
            switch (action) {
              case EventActions.SCREENSHARE_STARTED:
                setScreenShareData(prevState => {
                  return {
                    ...prevState,
                    [screenUidOfUser]: {
                      name: defaultContentRef.current.defaultContent[
                        screenUidOfUser
                      ]?.name,
                      isActive: true,
                      ts: value || 0,
                    },
                  };
                });
                break;
              case EventActions.SCREENSHARE_STOPPED:
                setScreenShareData(prevState => {
                  return {
                    ...prevState,
                    [screenUidOfUser]: {
                      name: defaultContentRef.current.defaultContent[
                        screenUidOfUser
                      ]?.name,
                      isActive: false,
                      ts: value || 0,
                    },
                  };
                });
                //if remote user started/stopped the screenshare then change the layout to pinned/grid
                //if user pinned somebody then don't triggerlayout change
                if (!pinnedUidRef.current.pinnedUid) {
                  triggerChangeLayout(false);
                }
                if (screenUidOfUser === pinnedUidRef.current.pinnedUid) {
                  triggerChangeLayout(false);
                  dispatch({
                    type: 'UserPin',
                    value: [0],
                  });
                }
                break;
              default:
                break;
            }
          }
        }
      },
    );

    return () => {
      unsubKickScreenshare();
      unsubScreenshareAttribute();
    };
  }, []);

  const ScreenshareStoppedCallback = () => {
    setScreenshareActive(false);
    logger.debug(LogSource.Internals, 'SCREENSHARE', 'screenshare stopped.');
    events.send(
      EventNames.SCREENSHARE_ATTRIBUTE,
      JSON.stringify({
        action: EventActions.SCREENSHARE_STOPPED,
        value: 0,
      }),
      PersistanceLevel.Sender,
    );
    setScreenShareData(prevState => {
      return {
        ...prevState,
        [screenShareUid]: {
          ...prevState[screenShareUid],
          isActive: false,
          ts: 0,
        },
      };
    });
    //if local user stopped the screenshare then change layout to grid
    //if user pinned somebody then don't triggerlayout change
    if (!pinnedUidRef.current.pinnedUid) {
      triggerChangeLayout(false);
    }
    if (screenShareUid === pinnedUidRef.current.pinnedUid) {
      triggerChangeLayout(false);
      dispatch({
        type: 'UserPin',
        value: [0],
      });
    }
  };

  useEffect(() => {
    // @ts-ignore
    rtc.RtcEngineUnsafe.addListener(
      'onScreenshareStopped',
      ScreenshareStoppedCallback,
    );
  }, []);

  const stopScreenshare = () => {
    if (!isScreenshareActive) {
      return;
    }
    userScreenshare(false);
  };
  const startScreenshare = () => {
    if (isScreenshareActive) {
      return;
    }
    userScreenshare(true);
  };

  const userScreenshare = async (isActive: boolean) => {
    logger.log(
      LogSource.Internals,
      'SCREENSHARE',
      `${isActive ? 'starting' : 'stopping'}  screenshare`,
      {
        channel,
        screenShareUid,
        encryption,
      },
    );
    try {
      // @ts-ignore
      await rtc.RtcEngineUnsafe.startScreenshare(
        screenShareToken,
        channel,
        null,
        screenShareUid,
        appId,
        rtc.RtcEngineUnsafe as unknown as IAgoraRTC,
        encryption as unknown as any,
        {encoderConfig: '1080p_2', optimizationMode: 'detail'},
      );
      isActive && setScreenshareActive(true);

      if (isActive) {
        // 1. Set local state
        setScreenShareData(prevState => {
          return {
            ...prevState,
            [screenShareUid]: {
              name: defaultContentRef.current.defaultContent[screenShareUid]
                ?.name,
              isActive: true,
              ts: timeNow(),
            },
          };
        });
        // 2. Inform everyone in the channel screenshare is actice
        events.send(
          EventNames.SCREENSHARE_ATTRIBUTE,
          JSON.stringify({
            action: EventActions.SCREENSHARE_STARTED,
            value: timeNow(),
            screenUidOfUser: screenShareUid,
          }),
          PersistanceLevel.Sender,
        );
      }
    } catch (e) {
      logger.error(
        LogSource.Internals,
        'SCREENSHARE',
        'failed to start screen share',
        e,
      );
      Toast.show({
        leadingIconName: 'alert',
        type: 'error',
        text1: toastHeading,
        text2: toastSubHeading,
        visibilityTime: 1000 * 10,
        primaryBtn: null,
        secondaryBtn: null,
      });
    }
  };

  return (
    <ScreenshareContext.Provider
      value={{
        isScreenshareActive,
        startScreenshare,
        stopScreenshare,
        //@ts-ignore
        ScreenshareStoppedCallback,
      }}>
      {props.children}
    </ScreenshareContext.Provider>
  );
};

export default ScreenshareConfigure;
