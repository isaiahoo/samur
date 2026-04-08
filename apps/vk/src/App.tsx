// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, lazy, Suspense } from "react";
import {
  AppRoot,
  SplitLayout,
  SplitCol,
  View,
  PanelHeader,
  Tabbar,
  TabbarItem,
  Spinner,
  ScreenSpinner,
} from "@vkontakte/vkui";
import {
  Icon28PlaceOutline,
  Icon28UsersOutline,
  Icon28Notifications,
  Icon28InfoOutline,
} from "@vkontakte/icons";
import { useNav, type PanelId } from "./hooks/useNav";
import { authVk, setToken } from "./services/api";
import { getLaunchParams, getUserInfo, vkBridge } from "./services/vkbridge";

const MapPanel = lazy(() => import("./panels/MapPanel"));
const ReportPanel = lazy(() => import("./panels/ReportPanel"));
const HelpPanel = lazy(() => import("./panels/HelpPanel"));
const HelpFormPanel = lazy(() => import("./panels/HelpFormPanel"));
const AlertsPanel = lazy(() => import("./panels/AlertsPanel"));
const InfoPanel = lazy(() => import("./panels/InfoPanel"));

export default function App() {
  const { activePanel, go, goBack } = useNav("map");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        // Init VK Bridge
        await vkBridge.send("VKWebAppInit");

        // Get user info for name
        const user = await getUserInfo();
        const name = user
          ? `${user.first_name} ${user.last_name}`
          : undefined;

        // Authenticate with backend
        const launchParams = getLaunchParams();
        const result = await authVk(launchParams, name);
        setToken(result.token);
      } catch (err) {
        console.error("VK auth failed:", err);
        // Continue anyway — public endpoints still work
      }
      setReady(true);
    }
    init();
  }, []);

  if (!ready) {
    return (
      <AppRoot>
        <ScreenSpinner />
      </AppRoot>
    );
  }

  const tabbar = (
    <Tabbar>
      <TabbarItem
        selected={activePanel === "map"}
        onClick={() => go("map")}
        text="Карта"
      >
        <Icon28PlaceOutline />
      </TabbarItem>
      <TabbarItem
        selected={activePanel === "help" || activePanel === "help-form"}
        onClick={() => go("help")}
        text="Помощь"
      >
        <Icon28UsersOutline />
      </TabbarItem>
      <TabbarItem
        selected={activePanel === "alerts"}
        onClick={() => go("alerts")}
        text="Оповещения"
      >
        <Icon28Notifications />
      </TabbarItem>
      <TabbarItem
        selected={activePanel === "info"}
        onClick={() => go("info")}
        text="Инфо"
      >
        <Icon28InfoOutline />
      </TabbarItem>
    </Tabbar>
  );

  return (
    <AppRoot>
      <SplitLayout>
        <SplitCol>
          <View activePanel={activePanel}>
            <Suspense fallback={<ScreenSpinner />}>
              <MapPanel id="map" go={go} />
              <ReportPanel id="report" goBack={goBack} />
              <HelpPanel id="help" go={go} />
              <HelpFormPanel id="help-form" goBack={goBack} />
              <AlertsPanel id="alerts" />
              <InfoPanel id="info" />
            </Suspense>
          </View>
        </SplitCol>
      </SplitLayout>
      {tabbar}
    </AppRoot>
  );
}
