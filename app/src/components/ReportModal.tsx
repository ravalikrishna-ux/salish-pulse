import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SAMPLE_SOCIAL_POSTS, VIEWING_SPOTS } from '../data/fallbackData';
import { palette, radii, spacing } from '../theme';
import { Ecotype, Sighting, SourceType, TravelDirection } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmitCitizenReport: (sighting: Sighting) => void;
  onSubmitRawSocialPost: (text: string, source: SourceType, handle: string) => void;
}

export const ReportModal: React.FC<Props> = ({
  visible,
  onClose,
  onSubmitCitizenReport,
  onSubmitRawSocialPost,
}) => {
  const [mode, setMode] = useState<'citizen' | 'social'>('citizen');

  // Citizen form state
  const [selectedSpotId, setSelectedSpotId] = useState(VIEWING_SPOTS[0].id);
  const [direction, setDirection] = useState<TravelDirection>('S');
  const [ecotype, setEcotype] = useState<Ecotype>('SRKW');
  const [count, setCount] = useState('4');
  const [notes, setNotes] = useState('');

  // Social NLP simulator state
  const [socialText, setSocialText] = useState(SAMPLE_SOCIAL_POSTS[0].text);
  const [socialSource, setSocialSource] = useState<SourceType>('bluesky');
  const [socialHandle, setSocialHandle] = useState(SAMPLE_SOCIAL_POSTS[0].handle);

  const handleCitizenSubmit = () => {
    const spot = VIEWING_SPOTS.find((s) => s.id === selectedSpotId) ?? VIEWING_SPOTS[0];
    const parsedCount = Math.max(1, parseInt(count, 10) || 2);
    const sighting: Sighting = {
      id: `citizen-${Date.now()}`,
      title: `${ecotype === 'SRKW' ? 'Southern Residents' : ecotype === 'BIGGS' ? "Bigg's Orcas" : 'Whales'} spotted off ${spot.name}`,
      locationName: `Off ${spot.name}`,
      waterway: spot.waterway,
      lat: Number((spot.lat + (Math.random() - 0.5) * 0.006).toFixed(4)),
      lng: Number((spot.lng - 0.012).toFixed(4)),
      ecotype,
      podId: ecotype === 'SRKW' ? 'SRKW (Citizen Report)' : ecotype === 'BIGGS' ? "Bigg's Transient" : undefined,
      estimatedCount: parsedCount,
      direction,
      speedKnots: direction === 'MILLING' ? 2.2 : 4.6,
      confidence: 'community',
      corroborationCount: 1,
      sources: ['citizen_app'],
      timestamp: new Date().toISOString(),
      summary:
        notes.trim() ||
        `Shore-based spotter report from ${spot.name}: ~${parsedCount} whales moving ${direction}.`,
      reporterHandle: 'You (Shore Spotter)',
    };
    onSubmitCitizenReport(sighting);
    setNotes('');
    onClose();
  };

  const handleSocialSubmit = () => {
    if (!socialText.trim()) return;
    onSubmitRawSocialPost(socialText.trim(), socialSource, socialHandle.trim() || '@spotter');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.heading}>Report or Ingest Sighting</Text>
              <Text style={styles.subheading}>
                Auto-corroborates nearby sightings & recalculates beach ETAs
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={palette.inkPrimary} />
            </Pressable>
          </View>

          <View style={styles.modeTabs}>
            <Pressable
              onPress={() => setMode('citizen')}
              style={[styles.modeTab, mode === 'citizen' && styles.modeTabActive]}
            >
              <Text style={[styles.modeTabText, mode === 'citizen' && styles.modeTabTextActive]}>
                1-Tap Shore Report
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('social')}
              style={[styles.modeTab, mode === 'social' && styles.modeTabActive]}
            >
              <Text style={[styles.modeTabText, mode === 'social' && styles.modeTabTextActive]}>
                Social NLP Pipeline Test
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {mode === 'citizen' ? (
              <>
                <Text style={styles.label}>Nearest Shore Landmark</Text>
                <View style={styles.pillWrap}>
                  {VIEWING_SPOTS.slice(0, 8).map((spot) => {
                    const active = spot.id === selectedSpotId;
                    return (
                      <Pressable
                        key={spot.id}
                        onPress={() => setSelectedSpotId(spot.id)}
                        style={[styles.selectPill, active && styles.selectPillActive]}
                      >
                        <Text
                          style={[styles.selectPillText, active && styles.selectPillTextActive]}
                        >
                          {spot.name.replace(' Lighthouse', '').replace(' Park', '')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Travel Direction</Text>
                <View style={styles.pillWrap}>
                  {(['N', 'S', 'MILLING', 'UNKNOWN'] as TravelDirection[]).map((dir) => {
                    const active = direction === dir;
                    return (
                      <Pressable
                        key={dir}
                        onPress={() => setDirection(dir)}
                        style={[styles.selectPill, active && styles.selectPillActive]}
                      >
                        <Text
                          style={[styles.selectPillText, active && styles.selectPillTextActive]}
                        >
                          {dir === 'N'
                            ? 'Northbound'
                            : dir === 'S'
                              ? 'Southbound'
                              : dir === 'MILLING'
                                ? 'Milling / Foraging'
                                : 'Unsure'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Whale Ecotype & Estimated Count</Text>
                <View style={styles.rowGap}>
                  {(['SRKW', 'BIGGS', 'HUMPBACK', 'UNKNOWN'] as Ecotype[]).map((eco) => {
                    const active = ecotype === eco;
                    return (
                      <Pressable
                        key={eco}
                        onPress={() => setEcotype(eco)}
                        style={[styles.selectPill, active && styles.selectPillActive]}
                      >
                        <Text
                          style={[styles.selectPillText, active && styles.selectPillTextActive]}
                        >
                          {eco === 'SRKW'
                            ? 'Southern Resident'
                            : eco === 'BIGGS'
                              ? "Bigg's"
                              : eco === 'HUMPBACK'
                                ? 'Humpback'
                                : 'Unsure'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.inputRow}>
                  <View style={{ width: 92 }}>
                    <Text style={styles.label}>Count</Text>
                    <TextInput
                      value={count}
                      onChangeText={setCount}
                      keyboardType="number-pad"
                      style={styles.input}
                      placeholder="4"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Shore Observation Notes (Optional)</Text>
                    <TextInput
                      value={notes}
                      onChangeText={setNotes}
                      style={styles.input}
                      placeholder="e.g., Mid-channel, large male fin visible with binoculars"
                    />
                  </View>
                </View>

                <View style={styles.noticeBox}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={palette.tealPrimary} />
                  <Text style={styles.noticeText}>
                    Location is coarsened ~750m over water to deter boat crowding and protect
                    endangered SRKWs.
                  </Text>
                </View>

                <Pressable onPress={handleCitizenSubmit} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Publish Sighting & Update ETAs</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Try a Sample Seattle Social Post</Text>
                <View style={styles.sampleList}>
                  {SAMPLE_SOCIAL_POSTS.map((sample, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => {
                        setSocialText(sample.text);
                        setSocialSource(sample.source);
                        setSocialHandle(sample.handle);
                      }}
                      style={styles.sampleCard}
                    >
                      <Text style={styles.sampleSource}>
                        {sample.source.toUpperCase()} • {sample.handle}
                      </Text>
                      <Text style={styles.sampleBody}>{sample.text}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Raw Social Post Text</Text>
                <TextInput
                  value={socialText}
                  onChangeText={setSocialText}
                  multiline
                  numberOfLines={3}
                  style={[styles.input, styles.textArea]}
                  placeholder="Paste a Bluesky, Reddit, or West Seattle Blog sighting post..."
                />

                <Pressable onPress={handleSocialSubmit} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Run NLP Parser & Ingest Into Feed</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 31, 46, 0.56)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: palette.bgSurface,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSubtle,
  },
  heading: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.inkPrimary,
  },
  subheading: {
    fontSize: 12.5,
    color: palette.inkSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: palette.bgSurfaceMuted,
  },
  modeTabs: {
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: palette.bgPage,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: palette.bgSurface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.inkSecondary,
  },
  modeTabTextActive: {
    color: palette.tealPrimary,
    fontWeight: '700',
  },
  body: {
    maxHeight: 500,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.inkSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowGap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgPage,
  },
  selectPillActive: {
    backgroundColor: palette.tealPrimary,
    borderColor: palette.tealPrimary,
  },
  selectPillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.inkPrimary,
  },
  selectPillTextActive: {
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: palette.inkPrimary,
    backgroundColor: '#FFFFFF',
    marginTop: 4,
  },
  textArea: {
    minHeight: 78,
    textAlignVertical: 'top',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radii.sm,
    backgroundColor: palette.tealSoft,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: palette.inkPrimary,
    lineHeight: 17,
  },
  primaryBtn: {
    backgroundColor: palette.tealPrimary,
    paddingVertical: 13,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  sampleList: {
    gap: 8,
  },
  sampleCard: {
    padding: 10,
    borderRadius: radii.sm,
    backgroundColor: palette.bgPage,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 4,
  },
  sampleSource: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.oceanBlue,
  },
  sampleBody: {
    fontSize: 12.5,
    color: palette.inkPrimary,
    lineHeight: 17,
  },
});
