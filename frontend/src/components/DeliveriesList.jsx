import React, { useState } from 'react';
import { MapPin, Search, RefreshCw, CheckCircle2, Clock, AlertCircle, Navigation } from 'lucide-react';

export default function DeliveriesList({ deliveries, loading, error, serviceHealth, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');

  const isFaulted = serviceHealth?.fault && serviceHealth.fault !== 'NONE';
  const faultType = serviceHealth?.fault;

  const filteredDeliveries = (deliveries || []).filter(d => 
    String(d.id || '').includes(searchTerm) ||
    String(d.shipmentId || '').includes(searchTerm) ||
    (d.status || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <MapPin className="w-4 h-4" />
            <span>Delivery Microservice (/deliveries) &bull; Port :8085</span>
          </div>
          <h2 className="text-xl font-bold text-white">Delivery Tracking & Dispatch</h2>
          <p className="text-slate-400 text-xs">
            Real-time delivery fulfillment assignments created by Delivery Service.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition self-start sm:self-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Outage / Fault Notice */}
      {(error || isFaulted) && (
        <div className="p-5 rounded-2xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs space-y-2 shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center space-x-2 font-bold text-sm text-rose-300">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span>Delivery Microservice Outage Detected</span>
            {faultType && (
              <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 text-[10px] font-extrabold uppercase">
                {faultType}
              </span>
            )}
          </div>
          <p className="text-slate-300">
            {error || `Delivery Service (:8085) is experiencing a ${faultType} fault. Final-mile courier routing and delivery status lookups are unavailable.`}
          </p>
        </div>
      )}

      {/* Filter */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search Delivery ID or Shipment ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">Delivery ID</th>
              <th className="py-3.5 px-4">Shipment ID</th>
              <th className="py-3.5 px-4">Delivery Status</th>
              <th className="py-3.5 px-4">Estimated Delivery</th>
              <th className="py-3.5 px-4 text-right">Last Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {loading && (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-500 font-sans">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  <span>Loading delivery records...</span>
                </td>
              </tr>
            )}

            {!loading && filteredDeliveries.map((d) => {
              const isDelivered = (d.status || '').toUpperCase() === 'DELIVERED';
              return (
                <tr key={d.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3.5 px-4 font-bold text-indigo-300">Deliv-#{d.id}</td>
                  <td className="py-3.5 px-4 font-bold text-white">Ship-#{d.shipmentId}</td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      isDelivered 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}>
                      {isDelivered ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                      {d.status || 'IN_TRANSIT'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 font-sans">{d.estimatedDelivery}</td>
                  <td className="py-3.5 px-4 text-right text-slate-400 font-sans flex items-center justify-end">
                    <Navigation className="w-3.5 h-3.5 mr-1 text-slate-500 flex-shrink-0" />
                    <span>{d.lastLocation}</span>
                  </td>
                </tr>
              );
            })}

            {!loading && filteredDeliveries.length === 0 && (
              <tr>
                <td colSpan="5" className="py-10 text-center text-slate-500 font-sans">
                  {isFaulted || error ? (
                    <div className="space-y-1">
                      <p className="text-rose-300 font-semibold">Delivery records unavailable</p>
                      <p className="text-xs text-slate-500">Service is down or unreachable. Records will appear once delivery-service recovers.</p>
                    </div>
                  ) : (
                    <span>No delivery tracking records found.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
