import React, { useState } from 'react';
import { Truck, Search, RefreshCw, MapPin, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ShipmentsList({ shipments, loading, error, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredShipments = (shipments || []).filter(s => 
    String(s.id || '').includes(searchTerm) ||
    String(s.orderId || '').includes(searchTerm) ||
    (s.address || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <Truck className="w-4 h-4" />
            <span>Shipping Microservice (/shipments)</span>
          </div>
          <h2 className="text-xl font-bold text-white">Logistics & Shipments</h2>
          <p className="text-slate-400 text-xs">
            View shipment dispatches generated automatically upon payment completion.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Filter */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search Shipment ID, Order ID, Address..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>Notice: {error}. Showing mock shipments data.</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">Shipment ID</th>
              <th className="py-3.5 px-4">Order ID</th>
              <th className="py-3.5 px-4">Destination Address</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Dispatch Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {loading && (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-500 font-sans">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  <span>Loading shipments...</span>
                </td>
              </tr>
            )}

            {!loading && filteredShipments.map((s) => (
              <tr key={s.id} className="hover:bg-slate-800/40 transition">
                <td className="py-3.5 px-4 font-bold text-indigo-300">Ship-#{s.id}</td>
                <td className="py-3.5 px-4 font-bold text-white">Order-#{s.orderId}</td>
                <td className="py-3.5 px-4 font-sans text-slate-300 flex items-center">
                  <MapPin className="w-3.5 h-3.5 mr-1 text-slate-500 flex-shrink-0" />
                  <span>{s.address}</span>
                </td>
                <td className="py-3.5 px-4">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {s.status || 'SHIPPED'}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right text-slate-400 font-sans">
                  {s.shippedDate ? new Date(s.shippedDate).toLocaleString() : 'Recently Dispatched'}
                </td>
              </tr>
            ))}

            {!loading && filteredShipments.length === 0 && (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-500 font-sans">
                  No shipments found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
