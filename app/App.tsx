import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { InteractiveMap } from './src/components/InteractiveMap';
import { ReportModal } from './src/components/ReportModal';
import { SightingCard } from './src/components/SightingCard';
import {
  BE_WHALE_WISE_RULES,
  HYDROPHONE_NODES,
  INITIAL_SIGHTINGS,
  VIEWING_SPOTS,
} from './src/data/fallbackData';
import {
  fetchConservationStatusFromBackend,
  fetchHydrophonesFromBackend,
  fetchSightingsFromBackend,
  postSocialOrSightingToBackend,
  subscribeToLiveStream,
} from './src/services/api';
import { registerForPushAlerts } from './src/services/notifications';
import {
  loadAlertPreferences,
  loadCachedSightings,
  saveAlertPreferences,
  saveCachedSightings,
} from './src/services/storage';
import { palette, radii, spacing } from './src/theme';
import {
  AlertPreferences,
  ConservationFreezeStatus,
  Ecotype,
  HydrophoneNode,
  PushRegistrationState,
  Sighting,
  SourceType,
  SpotWithEta,
} from './src/types';
import {
  enrichSpotsWithEta,
  formatRelativeTime,
  mergeOrPrependSighting,
  parseSocialPostSafe,
} from './src/utils/geo';

type PanelTab = 'feed' | 'beaches' | 'hydrophones' | 'alerts';
type FeedFilter = 'ALL' | 'SRKW' | 'BIGGS' | 'ACOUSTIC';

const DEFAULT_ALERT_PREFS: AlertPreferences = {
  enabled: true,
  favoriteSpotIds: ['alki-point', 'lincoln-park', 'west-point'],
  maxEtaMinutes: 45,
  minConfidence: 'corroborated',
  includeSrkw: true,
  includeBiggs: true,
  includeAcoustic: true,
  quietHoursEnabled: true,
};

export default function App() {
  const { width } = useWindowDimensions();
  const isWide = width >= 920;

  const [sightings, setSightings] = useState<Sighting[]>(INITIAL_SIGHTINGS);
  const [hydrophones, setHydrophones] = useState<HydrophoneNode[]>(HYDROPHONE_NODES);
  const [conservationFreeze, setConservationFreeze] = useState<ConservationFreezeStatus>({
    active: false,
    reason: null,
    corridors: [],
    expiresAt: null,
  });
  const [activeTab, setActiveTab] = useState<PanelTab>('feed');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('ALL');
  const [selectedSightingId, setSelectedSightingId] = useState<string | null>(
    INITIAL_SIGHTINGS[0].id
  );
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [alertPrefs, setAlertPrefs] = useState<AlertPreferences>(DEFAULT_ALERT_PREFS);
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [pushState, setPushState] = useState<PushRegistrationState>({
    permission: 'undetermined',
    channel: 'web_push',
    token: null,
    subscriptionId: null,
    syncedAt: null,
  });

  // 1. Instant Stale-While-Revalidate hydration from AsyncStorage
  useEffect(() => {
    let active = true;
    Promise.all([loadCachedSightings(), loadAlertPreferences()]).then(
      ([cachedSightings, cachedPrefs]) => {
        if (!active) return;
        if (cachedSightings && cachedSightings.length > 0) {
          setSightings(cachedSightings);
          setSelectedSightingId(cachedSightings[0].id);
        }
        if (cachedPrefs) {
          setAlertPrefs(cachedPrefs);
        }
        setPrefsHydrated(true);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  // Persist sightings & alert prefs locally on change
  useEffect(() => {
    if (prefsHydrated) {
      saveCachedSightings(sightings);
    }
  }, [sightings, prefsHydrated]);

  useEffect(() => {
    if (prefsHydrated) {
      saveAlertPreferences(alertPrefs);
    }
  }, [alertPrefs, prefsHydrated]);

  // 2. Connect to live backend REST + SSE stream with graceful offline fallback
  useEffect(() => {
    let active = true;

    fetchSightingsFromBackend().then((remote) => {
      if (active && remote && remote.length > 0) {
        setSightings(remote);
        setSelectedSightingId(remote[0].id);
      }
    });

    fetchHydrophonesFromBackend().then((remoteHydro) => {
      if (active && remoteHydro && remoteHydro.length > 0) {
        setHydrophones(remoteHydro);
      }
    });

    fetchConservationStatusFromBackend().then((freeze) => {
      if (active && freeze) {
        setConservationFreeze(freeze);
      }
    });

    const unsub = subscribeToLiveStream(
      (incoming) => {
        setSightings((prev) => {
          const { list, merged } = mergeOrPrependSighting(prev, incoming);
          showToast(
            merged
              ? `Corroborated: ${incoming.locationName} (confidence upgraded)`
              : `Live Alert: ${incoming.title}`
          );
          return list;
        });
      },
      (connected) => setStreamConnected(connected)
    );

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4500);
  };

  const handleEnablePushAlerts = async () => {
    const result = await registerForPushAlerts(alertPrefs);
    setPushState(result);
    if (result.syncedAt) {
      showToast(`Push alerts synced for ${alertPrefs.favoriteSpotIds.length} starred beaches!`);
    } else if (result.permission === 'granted') {
      showToast('Notification permission granted (preferences saved locally).');
    } else {
      showToast('Alert preferences saved locally — start backend to sync remote push.');
    }
  };

  const enrichedSpots = useMemo(() => enrichSpotsWithEta(VIEWING_SPOTS, sightings), [sightings]);

  const topActiveAlert = useMemo(() => {
    const favoriteHotSpot = enrichedSpots.find(
      (sp) =>
        sp.etaMinutes !== null &&
        sp.etaMinutes <= alertPrefs.maxEtaMinutes &&
        alertPrefs.favoriteSpotIds.includes(sp.id)
    );
    return favoriteHotSpot ?? enrichedSpots.find((sp) => sp.etaMinutes !== null) ?? null;
  }, [enrichedSpots, alertPrefs]);

  const filteredSightings = useMemo(() => {
    return sightings.filter((s) => {
      if (feedFilter === 'ALL') return true;
      if (feedFilter === 'ACOUSTIC') return s.confidence === 'acoustic';
      return s.ecotype === (feedFilter as Ecotype);
    });
  }, [sightings, feedFilter]);

  const handleSelectSighting = (s: Sighting) => {
    setSelectedSightingId(s.id);
    setSelectedSpotId(null);
    if (!isWide) setActiveTab('feed');
  };

  const handleSelectSpot = (spot: SpotWithEta) => {
    setSelectedSpotId(spot.id);
    setSelectedSightingId(null);
    if (!isWide) setActiveTab('beaches');
  };

  const handleCitizenReport = (sighting: Sighting) => {
    setSightings((prev) => {
      const { list, merged, targetId } = mergeOrPrependSighting(prev, sighting);
      setSelectedSightingId(targetId);
      showToast(
        merged
          ? `Corroborated existing sighting near ${sighting.locationName}!`
          : `Published report near ${sighting.locationName} — beach ETAs updated.`
      );
      return list;
    });
    postSocialOrSightingToBackend({
      text: sighting.summary,
      source: 'citizen_app',
      handle: 'SalishPulse Spotter',
    });
  };

  const handleSocialIngest = async (text: string, source: SourceType, handle: string) => {
    const remote = await postSocialOrSightingToBackend({ text, source, handle });
    if (remote && !remote.ok) {
      showToast(`NLP Noise Filter: ${remote.rejectedReason ?? 'Non-sighting filtered out.'}`);
      return;
    }

    let incomingSighting: Sighting;
    if (remote && remote.ok) {
      incomingSighting = remote.sighting;
    } else {
      const localParsed = parseSocialPostSafe(text, source, handle);
      if (!localParsed.ok) {
        showToast(`NLP Noise Filter: ${localParsed.reason}`);
        return;
      }
      incomingSighting = localParsed.sighting;
    }

    setSightings((prev) => {
      const { list, merged, targetId } = mergeOrPrependSighting(prev, incomingSighting);
      setSelectedSightingId(targetId);
      showToast(
        merged
          ? `NLP Deduplicator merged post into ${incomingSighting.locationName} cluster!`
          : `NLP Extracted: ${incomingSighting.estimatedCount} whales (${incomingSighting.direction}) at ${incomingSighting.locationName}`
      );
      return list;
    });
    setActiveTab('feed');
  };

  const toggleFavoriteSpot = (spotId: string) => {
    setAlertPrefs((prev) => {
      const exists = prev.favoriteSpotIds.includes(spotId);
      return {
        ...prev,
        favoriteSpotIds: exists
          ? prev.favoriteSpotIds.filter((id) => id !== spotId)
          : [...prev.favoriteSpotIds, spotId],
      };
    });
  };

  const renderRightPanel = () => {
    if (activeTab === 'feed') {
      return (
        <View style={styles.panelSection}>
          <View style={styles.filterRow}>
            {(['ALL', 'SRKW', 'BIGGS', 'ACOUSTIC'] as FeedFilter[]).map((key) => {
              const active = feedFilter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setFeedFilter(key)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {key === 'ALL'
                      ? `All (${sightings.length})`
                      : key === 'SRKW'
                        ? 'Southern Residents'
                        : key === 'BIGGS'
                          ? "Bigg's"
                          : 'Hydrophone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.cardList}>
            {filteredSightings.map((s) => (
              <SightingCard
                key={s.id}
                sighting={s}
                selected={s.id === selectedSightingId}
                onPress={() => setSelectedSightingId(s.id)}
              />
            ))}
          </View>
        </View>
      );
    }

    if (activeTab === 'beaches') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.sectionHint}>
            Shore beaches ranked by predicted pod arrival ETA. Starred beaches persist locally and
            trigger geofenced push alerts.
          </Text>
          <View style={styles.cardList}>
            {enrichedSpots.map((spot) => {
              const isFav = alertPrefs.favoriteSpotIds.includes(spot.id);
              const isSelected = spot.id === selectedSpotId;
              return (
                <Pressable
                  key={spot.id}
                  onPress={() => setSelectedSpotId(spot.id)}
                  style={[styles.spotCard, isSelected && styles.spotCardSelected]}
                >
                  <View style={styles.spotTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spotName}>{spot.name}</Text>
                      <Text style={styles.spotArea}>
                        {spot.area} • {spot.waterway}
                      </Text>
                    </View>
                    <View style={styles.spotActions}>
                      {spot.etaMinutes !== null ? (
                        <View
                          style={[
                            styles.etaBadge,
                            spot.likelihood === 'high' ? styles.etaBadgeHot : styles.etaBadgeWarm,
                          ]}
                        >
                          <Text
                            style={[
                              styles.etaBadgeText,
                              spot.likelihood === 'high'
                                ? styles.etaBadgeTextHot
                                : styles.etaBadgeTextWarm,
                            ]}
                          >
                            {spot.etaMinutes <= 3 ? 'Passing NOW' : `ETA ~${spot.etaMinutes}m`}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.quietLabel}>Quiet</Text>
                      )}
                      <Pressable onPress={() => toggleFavoriteSpot(spot.id)} style={styles.starBtn}>
                        <Ionicons
                          name={isFav ? 'star' : 'star-outline'}
                          size={18}
                          color={isFav ? palette.amber : palette.inkMuted}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {spot.approachingPodLabel ? (
                    <Text style={styles.approachingLine}>
                      Approaching: {spot.approachingPodLabel} ({spot.distanceKm} km away)
                    </Text>
                  ) : null}

                  <Text style={styles.spotNote}>{spot.sightlineNote}</Text>
                  <Text style={styles.spotParking}>Parking: {spot.parkingTip}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }

    if (activeTab === 'hydrophones') {
      return (
        <View style={styles.panelSection}>
          <Text style={styles.sectionHint}>
            Live underwater microphones across Puget Sound &amp; Admiralty Inlet powered by
            Orcasound + OrcaHello AI detection.
          </Text>
          <View style={styles.cardList}>
            {hydrophones.map((node) => {
              const detecting = node.status === 'detecting';
              return (
                <View
                  key={node.id}
                  style={[styles.hydroCard, detecting && styles.hydroCardDetecting]}
                >
                  <View style={styles.spotTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spotName}>{node.name}</Text>
                      <Text style={styles.spotArea}>{node.region}</Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        detecting ? styles.statusPillLive : styles.statusPillOnline,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          detecting ? styles.statusPillTextLive : styles.statusPillTextOnline,
                        ]}
                      >
                        {detecting ? 'CALLS DETECTED' : 'LISTENING'}
                      </Text>
                    </View>
                  </View>
                  {node.lastDetectionSummary ? (
                    <Text style={styles.spotNote}>{node.lastDetectionSummary}</Text>
                  ) : null}
                  <View style={styles.hydroFooter}>
                    <Text style={styles.hydroTime}>
                      {node.lastDetectionIso
                        ? `Last event ${formatRelativeTime(node.lastDetectionIso)}`
                        : 'Live audio online'}
                    </Text>
                    <Pressable
                      onPress={() => Linking.openURL(node.streamUrl)}
                      style={styles.listenBtn}
                    >
                      <Ionicons name="headset-outline" size={14} color={palette.oceanBlue} />
                      <Text style={styles.listenBtnText}>Listen Live</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      );
    }

    // Alerts & WA Be Whale Wise Conservation Rules
    return (
      <View style={styles.panelSection}>
        <View style={styles.prefCard}>
          <Text style={styles.prefHeading}>Smart Anti-Fatigue Push Alerts</Text>
          <View style={styles.prefRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefTitle}>Geofenced Push &amp; Web Alerts</Text>
              <Text style={styles.prefSub}>
                Notify only when pods head toward your {alertPrefs.favoriteSpotIds.length} starred
                beaches (45m cooldown)
              </Text>
            </View>
            <Switch
              value={alertPrefs.enabled}
              onValueChange={(v) => setAlertPrefs((p) => ({ ...p, enabled: v }))}
              trackColor={{ true: palette.tealPrimary, false: palette.border }}
            />
          </View>

          <View style={styles.prefRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefTitle}>Daylight Quiet Hours (Seattle Time)</Text>
              <Text style={styles.prefSub}>Pause shore viewing pushes after sunset</Text>
            </View>
            <Switch
              value={alertPrefs.quietHoursEnabled}
              onValueChange={(v) => setAlertPrefs((p) => ({ ...p, quietHoursEnabled: v }))}
              trackColor={{ true: palette.tealPrimary, false: palette.border }}
            />
          </View>

          <Text style={styles.prefSubHeader}>Alert Window (Max Arrival ETA)</Text>
          <View style={styles.filterRow}>
            {[20, 45, 75].map((mins) => {
              const active = alertPrefs.maxEtaMinutes === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => setAlertPrefs((p) => ({ ...p, maxEtaMinutes: mins }))}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    Under {mins} min
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={handleEnablePushAlerts} style={styles.syncPushBtn}>
            <Ionicons name="notifications-outline" size={16} color="#FFFFFF" />
            <Text style={styles.syncPushBtnText}>
              {pushState.syncedAt
                ? `Push Synced (${pushState.permission})`
                : 'Enable & Sync Push Subscription'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.prefCard}>
          <View style={styles.ruleHeader}>
            <Ionicons name="shield-checkmark" size={18} color={palette.srkw} />
            <Text style={styles.prefHeading}>WA State Be Whale Wise Law (2025+)</Text>
          </View>
          {BE_WHALE_WISE_RULES.map((rule) => (
            <View key={rule.id} style={styles.ruleItem}>
              <Text style={styles.ruleApplies}>{rule.appliesTo}</Text>
              <Text style={styles.ruleDistance}>
                {rule.distanceRule} • {rule.speedRule}
              </Text>
              <Text style={styles.ruleDetail}>{rule.detail}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      {/* Top Maritime Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Ionicons name="water" size={20} color="#2DD4BF" />
          </View>
          <View>
            <Text style={styles.brandTitle}>SalishPulse</Text>
            <Text style={styles.brandSubtitle}>
              Seattle &amp; Puget Sound Real-Time Orca Tracker
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.liveChip}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: streamConnected ? '#2DD4BF' : '#38BDF8' },
              ]}
            />
            <Text style={styles.liveChipText}>
              {streamConnected ? 'SSE Live' : 'Offline Cache + Sim'}
            </Text>
          </View>

          <Pressable onPress={() => setReportVisible(true)} style={styles.reportBtn}>
            <Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />
            <Text style={styles.reportBtnText}>Report / Ingest</Text>
          </Pressable>
        </View>
      </View>

      {/* Partner Conservation Freeze Alert Banner */}
      {conservationFreeze.active ? (
        <View style={styles.freezeBanner}>
          <Ionicons name="shield" size={17} color="#FFFFFF" />
          <Text style={styles.freezeBannerText}>
            Partner Conservation Freeze Active:{' '}
            {conservationFreeze.reason ??
              'Public SRKW pins temporarily paused to protect resting/foraging whales.'}
          </Text>
        </View>
      ) : null}

      {/* Active Approaching Pod Alert Banner */}
      {topActiveAlert ? (
        <Pressable onPress={() => handleSelectSpot(topActiveAlert)} style={styles.alertBanner}>
          <View style={styles.alertBannerLeft}>
            <Ionicons name="navigate-circle" size={18} color="#FFFFFF" />
            <Text style={styles.alertBannerText} numberOfLines={1}>
              {topActiveAlert.approachingPodLabel ?? 'Orcas'} approaching{' '}
              <Text style={{ fontWeight: '800' }}>{topActiveAlert.name}</Text> —{' '}
              {topActiveAlert.etaMinutes !== null && topActiveAlert.etaMinutes <= 3
                ? 'Passing shoreline NOW'
                : `ETA ~${topActiveAlert.etaMinutes} min`}
            </Text>
          </View>
          <Text style={styles.alertBannerCta}>View Spot →</Text>
        </Pressable>
      ) : null}

      {/* Toast Notification */}
      {toastMessage ? (
        <View style={styles.toast}>
          <Ionicons name="sparkles" size={15} color="#2DD4BF" />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* Main Content: Responsive Split Pane on Web/Tablet, Stacked on Mobile */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={[styles.mainContent, isWide && styles.mainContentWide]}
      >
        {/* Left Column: Interactive MapLibre / Puget Sound Chart + Conservation Strip */}
        <View style={[styles.mapColumn, isWide && styles.mapColumnWide]}>
          <InteractiveMap
            sightings={sightings}
            spots={enrichedSpots}
            hydrophones={hydrophones}
            selectedSightingId={selectedSightingId}
            selectedSpotId={selectedSpotId}
            onSelectSighting={handleSelectSighting}
            onSelectSpot={handleSelectSpot}
            height={isWide ? 560 : 350}
          />

          <View style={styles.conservationStrip}>
            <Ionicons name="information-circle-outline" size={16} color={palette.srkw} />
            <Text style={styles.conservationText}>
              WA Law (2025+): Vessels &amp; kayaks must stay{' '}
              <Text style={{ fontWeight: '700' }}>1,000 yds</Text> from Southern Resident orcas
              (public pins coarsened ~750m over water) and{' '}
              <Text style={{ fontWeight: '700' }}>200 yds</Text> from Bigg&apos;s. Watch
              zero-impact from shore!
            </Text>
          </View>
        </View>

        {/* Right Column: Tabbed Live Feed, Beaches, Hydrophones, Alerts */}
        <View style={[styles.sideColumn, isWide && styles.sideColumnWide]}>
          <View style={styles.tabBar}>
            {(
              [
                { id: 'feed', label: 'Live Feed', icon: 'pulse-outline' },
                { id: 'beaches', label: 'Beaches', icon: 'compass-outline' },
                { id: 'hydrophones', label: 'Audio', icon: 'headset-outline' },
                { id: 'alerts', label: 'Alerts', icon: 'notifications-outline' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                >
                  <Ionicons
                    name={tab.icon}
                    size={15}
                    color={active ? palette.tealPrimary : palette.inkMuted}
                  />
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {renderRightPanel()}
        </View>
      </ScrollView>

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        onSubmitCitizenReport={handleCitizenReport}
        onSubmitRawSocialPost={handleSocialIngest}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bgPage,
  },
  header: {
    backgroundColor: palette.bgHeader,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(45, 212, 191, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(45, 212, 191, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandTitle: {
    color: palette.inkInverse,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    color: palette.inkInverseMuted,
    fontSize: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  liveChipText: {
    color: '#D9EBF5',
    fontSize: 12,
    fontWeight: '600',
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.tealPrimary,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radii.pill,
  },
  reportBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  freezeBanner: {
    backgroundColor: palette.srkw,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  freezeBannerText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
  alertBanner: {
    backgroundColor: '#134A5E',
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  alertBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  alertBannerText: {
    color: '#F3FAFC',
    fontSize: 13,
    flex: 1,
  },
  alertBannerCta: {
    color: '#5EEAD4',
    fontSize: 12.5,
    fontWeight: '700',
  },
  toast: {
    backgroundColor: '#0E2A3F',
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(45, 212, 191, 0.35)',
  },
  toastText: {
    color: '#E8F6FA',
    fontSize: 12.5,
    fontWeight: '600',
  },
  mainScroll: {
    flex: 1,
  },
  mainContent: {
    padding: spacing.md,
    gap: spacing.md,
    maxWidth: 1320,
    width: '100%',
    alignSelf: 'center',
  },
  mainContentWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  mapColumn: {
    gap: spacing.sm,
  },
  mapColumnWide: {
    flex: 1.15,
  },
  sideColumn: {
    gap: spacing.md,
  },
  sideColumnWide: {
    flex: 1,
  },
  conservationStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.srkwSoft,
    borderWidth: 1,
    borderColor: '#F2CAC6',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  conservationText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: palette.inkPrimary,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: palette.bgSurface,
    borderRadius: radii.md,
    padding: 4,
    borderWidth: 1,
    borderColor: palette.border,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radii.sm,
  },
  tabBtnActive: {
    backgroundColor: palette.tealSoft,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.inkMuted,
  },
  tabLabelActive: {
    color: palette.tealPrimary,
    fontWeight: '700',
  },
  panelSection: {
    gap: spacing.md,
  },
  sectionHint: {
    fontSize: 12.5,
    color: palette.inkSecondary,
    lineHeight: 18,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: palette.bgSurface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  filterPillActive: {
    backgroundColor: palette.inkPrimary,
    borderColor: palette.inkPrimary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.inkSecondary,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  cardList: {
    gap: spacing.sm,
  },
  spotCard: {
    backgroundColor: palette.bgSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 6,
  },
  spotCardSelected: {
    borderColor: palette.tealPrimary,
  },
  spotTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  spotName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: palette.inkPrimary,
  },
  spotArea: {
    fontSize: 12,
    color: palette.inkMuted,
    marginTop: 1,
  },
  spotActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  etaBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  etaBadgeHot: {
    backgroundColor: palette.tealSoft,
  },
  etaBadgeWarm: {
    backgroundColor: palette.amberSoft,
  },
  etaBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  etaBadgeTextHot: {
    color: palette.tealPrimary,
  },
  etaBadgeTextWarm: {
    color: palette.amber,
  },
  quietLabel: {
    fontSize: 12,
    color: palette.inkMuted,
    fontWeight: '600',
  },
  starBtn: {
    padding: 4,
  },
  approachingLine: {
    fontSize: 12.5,
    fontWeight: '700',
    color: palette.tealPrimary,
  },
  spotNote: {
    fontSize: 12.5,
    color: palette.inkSecondary,
    lineHeight: 18,
  },
  spotParking: {
    fontSize: 12,
    color: palette.inkMuted,
  },
  hydroCard: {
    backgroundColor: palette.bgSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
  },
  hydroCardDetecting: {
    borderColor: '#38BDF8',
    backgroundColor: '#F5FBFE',
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  statusPillLive: {
    backgroundColor: palette.acousticSoft,
  },
  statusPillOnline: {
    backgroundColor: palette.bgSurfaceMuted,
  },
  statusPillText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  statusPillTextLive: {
    color: palette.acoustic,
  },
  statusPillTextOnline: {
    color: palette.inkSecondary,
  },
  hydroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
  hydroTime: {
    fontSize: 11.5,
    color: palette.inkMuted,
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: palette.oceanSoft,
  },
  listenBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.oceanBlue,
  },
  prefCard: {
    backgroundColor: palette.bgSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 12,
  },
  prefHeading: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.inkPrimary,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  prefTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: palette.inkPrimary,
  },
  prefSub: {
    fontSize: 12,
    color: palette.inkSecondary,
    marginTop: 1,
  },
  prefSubHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.inkSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  syncPushBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: palette.tealPrimary,
    paddingVertical: 11,
    borderRadius: radii.md,
    marginTop: 2,
  },
  syncPushBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ruleItem: {
    borderTopWidth: 1,
    borderTopColor: palette.borderSubtle,
    paddingTop: 10,
    gap: 3,
  },
  ruleApplies: {
    fontSize: 13.5,
    fontWeight: '700',
    color: palette.inkPrimary,
  },
  ruleDistance: {
    fontSize: 12.5,
    fontWeight: '700',
    color: palette.srkw,
  },
  ruleDetail: {
    fontSize: 12,
    color: palette.inkSecondary,
    lineHeight: 17,
  },
});
