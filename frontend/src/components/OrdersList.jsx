import React, { useState } from 'react';
import { Package, Search, RefreshCw, Compass, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export default function OrdersList({ orders, loading, error, onRefresh, onSelectTrackOrder }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filteredOrders = (orders || []).filter(order => {
    const matchesSearch = 
      String(order.id || '').includes(searchTerm) ||
      String(order.customerId || '').includes(searchTerm) ||
      String(order.productId || '').includes(searchTerm);
    
    const matchesStatus = statusFilter === 'ALL' || (order.status || '').toUpperCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status) => {
    const s = (status || '').toUpperCase();
    if (s === 'COMPLETED' || s === 'SUCCESS') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          COMPLETED
        </span>
      );
    } else if (s === 'PENDING') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <Clock className="w-3 h-3 mr-1" />
          PENDING
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          {s || 'FAILED'}
        </span>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <Package className="w-4 h-4" />
            <span>Order Microservice (/orders)</span>
          </div>
          <h2 className="text-xl font-bold text-white">Orders Directory</h2>
          <p className="text-slate-400 text-xs">
            Viewing live order entity records processed through Order Service.
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

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search Order ID or Customer ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto">
          {['ALL', 'COMPLETED', 'PENDING', 'FAILED'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                statusFilter === st 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>Notice: {error}. Displaying mock records.</span>
        </div>
      )}

      {/* Orders Table */}
      <div className="overflow-x-auto rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">Order ID</th>
              <th className="py-3.5 px-4">Customer ID</th>
              <th className="py-3.5 px-4">Product ID</th>
              <th className="py-3.5 px-4">Qty</th>
              <th className="py-3.5 px-4">Amount</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Lifecycle Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {loading && (
              <tr>
                <td colSpan="7" className="py-8 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  <span>Loading orders...</span>
                </td>
              </tr>
            )}

            {!loading && filteredOrders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-800/40 transition">
                <td className="py-3.5 px-4 font-bold text-indigo-300">#{order.id}</td>
                <td className="py-3.5 px-4 text-slate-300">Cust-{order.customerId}</td>
                <td className="py-3.5 px-4 text-slate-300">Prod-{order.productId}</td>
                <td className="py-3.5 px-4 font-bold text-white">{order.quantity}</td>
                <td className="py-3.5 px-4 font-bold text-emerald-400">${Number(order.amount || 0).toFixed(2)}</td>
                <td className="py-3.5 px-4">{getStatusBadge(order.status)}</td>
                <td className="py-3.5 px-4 text-right">
                  <button
                    onClick={() => onSelectTrackOrder(order)}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600 hover:text-white text-[11px] font-semibold transition"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Track Lifecycle</span>
                  </button>
                </td>
              </tr>
            ))}

            {!loading && filteredOrders.length === 0 && (
              <tr>
                <td colSpan="7" className="py-8 text-center text-slate-500 font-sans">
                  No orders found. Place a new order using the "Create Order" button!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
