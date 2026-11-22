import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, radii, spacing } from '../theme';
import { Sighting } from '../types';
import { formatDirectionLabel, formatRelativeTime, formatSourceLabel } from '../utils/geo';

interface Props {
  sighting: Sighting;
  selected: boolean;
  onPress: () => void;
}

export const SightingCard: React.FC<Props> = ({ sighting, selected, onPress }) => {
  const ecotypeMeta = (() => {
    if (sighting.confidence === 'acoustic') {
      return { label: 'Hydrophone AI', bg: palette.acousticSoft, fg: palette.acoustic };
    }
    switch (sighting.ecotype) {
      case 'SRKW':
        return { label: 'Southern Resident', bg: palette.srkwSoft, fg: palette.srkw };
      case 'BIGGS':
        return { label: "Bigg's Transient", bg: palette.biggsSoft, fg: palette.biggs };
      case 'HUMPBACK':
        return { label: 'Humpback', bg: palette.otherWhaleSoft, fg: palette.otherWhale };
      case 'GRAY':
        return { label: 'Gray Whale', bg: palette.otherWhaleSoft, fg: palette.otherWhale };
      default:
        return { label: 'Orca Unconfirmed', bg: palette.amberSoft, fg: palette.amber };
    }
  })();

  const confidenceMeta = (() => {
    switch (sighting.confidence) {
      case 'verified':
        return { label: `Verified • ${sighting.corroborationCount} reports`, color: palette.verified, bg: palette.verifiedSoft };
      case 'corroborated':
        return { label: `Corroborated • ${sighting.corroborationCount} reports`, color: palette.oceanBlue, bg: palette.oceanSoft };
      case 'acoustic':
        return { label: 'OrcaHello AI + Expert', color: palette.acoustic, bg: palette.acousticSoft };
      default:
        return { label: 'Community Report', color: palette.amber, bg: palette.amberSoft };
    }
  })();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: ecotypeMeta.bg }]}>
            <Text style={[styles.badgeText, { color: ecotypeMeta.fg }]}>{ecotypeMeta.label}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: confidenceMeta.bg }]}>
            <Text style={[styles.badgeText, { color: confidenceMeta.color }]}>
              {confidenceMeta.label}
            </Text>
          </View>
        </View>
        <Text style={styles.timeText}>{formatRelativeTime(sighting.timestamp)}</Text>
      </View>

      <Text style={styles.title}>{sighting.title}</Text>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={14} color={palette.inkSecondary} />
          <Text style={styles.metaText}>{sighting.locationName}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="compass-outline" size={14} color={palette.inkSecondary} />
          <Text style={styles.metaText}>
            {formatDirectionLabel(sighting.direction)} • {sighting.speedKnots.toFixed(1)} kn
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="water-outline" size={14} color={palette.inkSecondary} />
          <Text style={styles.metaText}>
            ~{sighting.estimatedCount} {sighting.estimatedCount === 1 ? 'whale' : 'whales'}
            {sighting.podId ? ` (${sighting.podId})` : ''}
          </Text>
        </View>
      </View>

      <Text style={styles.summary} numberOfLines={selected ? 5 : 2}>
        {sighting.summary}
      </Text>

      {selected && sighting.rawExcerpt ? (
        <View style={styles.excerptBox}>
          <Text style={styles.excerptLabel}>Aggregated Source Excerpt</Text>
          <Text style={styles.excerptText}>{sighting.rawExcerpt}</Text>
        </View>
      ) : null}

      <View style={styles.sourcesRow}>
        {sighting.sources.map((src) => (
          <View key={src} style={styles.sourcePill}>
            <Text style={styles.sourcePillText}>{formatSourceLabel(src)}</Text>
          </View>
        ))}
        {(sighting.isCoarsened || sighting.ecotype === 'SRKW') && (
          <View style={[styles.sourcePill, { backgroundColor: palette.srkwSoft, borderColor: '#F2CAC6' }]}>
            <Text style={[styles.sourcePillText, { color: palette.srkw }]}>
              ~{sighting.coarseningRadiusMeters ?? 750}m SRKW Buffer
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.bgSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
  },
  cardSelected: {
    borderColor: palette.tealPrimary,
    backgroundColor: '#FAFDFE',
  },
  cardPressed: {
    opacity: 0.94,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.inkMuted,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.inkPrimary,
    lineHeight: 20,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12.5,
    color: palette.inkSecondary,
    fontWeight: '500',
  },
  summary: {
    fontSize: 13,
    lineHeight: 18.5,
    color: palette.inkSecondary,
  },
  excerptBox: {
    backgroundColor: palette.bgSurfaceMuted,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 3,
  },
  excerptLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: palette.inkMuted,
  },
  excerptText: {
    fontSize: 12,
    color: palette.inkPrimary,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  sourcesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
  },
  sourcePill: {
    backgroundColor: palette.bgPage,
    borderWidth: 1,
    borderColor: palette.borderSubtle,
    borderRadius: radii.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sourcePillText: {
    fontSize: 11,
    color: palette.inkSecondary,
    fontWeight: '600',
  },
});
