/**
 * severity.js — Centralized Severity, Criticality, and Color Configuration
 *
 * Provides a unified threshold and color-coding standard across all dashboard components:
 *   - DependencyGraph
 *   - SystemStatus / Header
 *   - OverviewPage (System Criticality Gauge & Sparklines)
 *   - ServiceCard
 *   - IncidentFeed
 */

export const SEVERITY_THRESHOLDS = {
  HEALTHY: { min: 0,  max: 10, label: 'HEALTHY',  color: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  WARNING: { min: 10, max: 30, label: 'LOW RISK', color: '#eab308', text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  DEGRADED:{ min: 30, max: 60, label: 'MEDIUM RISK', color: '#f97316', text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  HIGH:    { min: 60, max: 80, label: 'HIGH RISK',   color: '#ef4444', text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30' },
  CRITICAL:{ min: 80, max: 100,label: 'CRITICAL',   color: '#dc2626', text: 'text-red-500',    bg: 'bg-red-950/40',    border: 'border-red-600/50' },
}

/**
 * Returns consistent severity styling by percentage (0 - 100).
 */
export function getSeverityByPercentage(pct = 0) {
  const n = Number(pct) || 0
  if (n <= 10) return SEVERITY_THRESHOLDS.HEALTHY
  if (n <= 30) return SEVERITY_THRESHOLDS.WARNING
  if (n <= 60) return SEVERITY_THRESHOLDS.DEGRADED
  if (n <= 80) return SEVERITY_THRESHOLDS.HIGH
  return SEVERITY_THRESHOLDS.CRITICAL
}

/**
 * Header and System status badge configuration
 */
export function getRiskBadge(criticalityPct = 0, riskLevel = 'LOW') {
  const pct = Number(criticalityPct) || 0
  const upper = String(riskLevel).toUpperCase()

  if (pct > 80 || upper === 'CRITICAL') {
    return {
      label: 'CRITICAL RISK',
      color: '#dc2626',
      badgeClass: 'bg-red-950/70 border-red-700 text-red-400 shadow-sm shadow-red-950/50',
      dotClass: 'bg-red-500 animate-ping',
    }
  }
  if (pct > 60 || upper === 'HIGH') {
    return {
      label: 'HIGH RISK',
      color: '#ef4444',
      badgeClass: 'bg-red-950/40 border-red-800/60 text-red-400 shadow-sm shadow-red-950/40',
      dotClass: 'bg-red-500',
    }
  }
  if (pct > 40 || upper === 'MEDIUM' || upper === 'DEGRADED') {
    return {
      label: 'MEDIUM RISK',
      color: '#f97316',
      badgeClass: 'bg-orange-950/40 border-orange-800/60 text-orange-400 shadow-sm shadow-orange-950/30',
      dotClass: 'bg-orange-500',
    }
  }
  if (pct > 20 || upper === 'MODERATE' || upper === 'LOW') {
    return {
      label: 'MODERATE RISK',
      color: '#eab308',
      badgeClass: 'bg-amber-950/40 border-amber-800/60 text-amber-400 shadow-sm shadow-amber-950/20',
      dotClass: 'bg-amber-400',
    }
  }
  return {
    label: 'HEALTHY / LOW RISK',
    color: '#10b981',
    badgeClass: 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400',
    dotClass: 'bg-emerald-400',
  }
}

/**
 * Architectural Business Importance metadata
 */
export const BUSINESS_IMPORTANCE = {
  omnistore: {
    order:        { tier: 'Critical', weight: '1.00', desc: 'Controls order creation and checkout orchestration' },
    payment:      { tier: 'Critical', weight: '1.00', desc: 'Handles payment authorization and financial transactions' },
    inventory:    { tier: 'Critical', weight: '0.90', desc: 'Controls stock availability and inventory reservation' },
    shipping:     { tier: 'High',     weight: '0.70', desc: 'Coordinates shipment creation and carrier dispatch' },
    delivery:     { tier: 'High',     weight: '0.65', desc: 'Handles package delivery tracking and fulfillment status' },
    notification: { tier: 'Medium',   weight: '0.35', desc: 'Sends customer SMS, push and email notifications' },
  },
  moviestream: {
    catalog:        { tier: 'Critical', weight: '0.95', desc: 'Provides movie metadata, search, and availability for all discovery' },
    user:           { tier: 'High',     weight: '0.80', desc: 'Manages customer profiles, authentication, and preferences' },
    recommendation: { tier: 'Medium',   weight: '0.50', desc: 'Generates personalized movie suggestion rails' },
    watchlist:      { tier: 'Medium',   weight: '0.40', desc: 'Stores customer saved titles' },
    history:        { tier: 'Medium',   weight: '0.40', desc: 'Records user playback activity and watch progress' },
  }
}
