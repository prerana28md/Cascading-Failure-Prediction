import React, { useState, useEffect } from 'react'
import { X, Terminal, Server } from 'lucide-react'
import ServiceLogViewer from './ServiceLogViewer'
import { toLabel, SERVICE_COLOR } from './ServiceCard'
import { WORKLOAD_SERVICES, WORKLOAD_PORTS } from '../lib/api'

/**
 * ServiceLogModal
 *
 * Full modal overlay for viewing and searching service logs.
 *
 * Props:
 *   isOpen             bool
 *   onClose            fn
 *   serviceKey         string    initial or active service key
 *   workload           string    'omnistore' | 'moviestream'
 *   availableServices  string[]  optional list of services available for switching
 */
export default function ServiceLogModal({
  isOpen,
  onClose,
  serviceKey: initialServiceKey = 'order',
  workload = 'omnistore',
  availableServices = [],
}) {
  const [activeService, setActiveService] = useState(initialServiceKey)

  // Keep internal selection synced when parent changes initialServiceKey
  useEffect(() => {
    if (initialServiceKey) {
      setActiveService(initialServiceKey)
    }
  }, [initialServiceKey])

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const activeWorkloadServices = availableServices.length > 0
    ? availableServices
    : (WORKLOAD_SERVICES[workload] ?? WORKLOAD_SERVICES.omnistore)

  const currentService = activeService || activeWorkloadServices[0] || 'order'
  const color = SERVICE_COLOR[currentService] ?? '#6366f1'
  const port = WORKLOAD_PORTS[currentService] ?? '?'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/80 flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm"
              style={{
                backgroundColor: `${color}25`,
                borderColor: `${color}60`
              }}
            >
              <Terminal size={15} style={{ color }} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                  <span>Microservice Live Log Stream</span>
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                  {workload === 'moviestream' ? 'MovieStream' : 'OmniStore'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Inspect real-time telemetry, error traces, and request events for <span className="font-semibold text-slate-200">{toLabel(currentService)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              title="Close log viewer (Esc)"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Modal Body: Embedded ServiceLogViewer */}
        <div className="p-4 overflow-y-auto flex-1 bg-slate-900">
          <ServiceLogViewer
            serviceKey={currentService}
            workload={workload}
            availableServices={activeWorkloadServices}
            onSelectService={setActiveService}
            embedded={true}
            heightClass="max-h-[55vh]"
          />
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/60 text-[11px] text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="font-mono text-slate-300">{currentService}-service</span>
            <span>·</span>
            <span>Port {port}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 font-mono">Press ESC to close</span>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
