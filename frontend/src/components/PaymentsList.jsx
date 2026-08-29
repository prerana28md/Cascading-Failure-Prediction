import React, { useState } from 'react';
import { CreditCard, Search, RefreshCw, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

export default function PaymentsList({ payments, loading, error, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPayments = (payments || []).filter(p => 
    String(p.id || '').includes(searchTerm) ||
    String(p.orderId || '').includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <CreditCard className="w-4 h-4" />
            <span>Payment Microservice (/payments)</span>
          </div>
          <h2 className="text-xl font-bold text-white">Payment Transactions</h2>
          <p className="text-slate-400 text-xs">
            Monitor real-time payment records processed by Payment Service following order placements.
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
          placeholder="Search Payment ID or Order ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>Notice: {error}. Showing mock payment records.</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">Payment ID</th>
              <th className="py-3.5 px-4">Associated Order ID</th>
              <th className="py-3.5 px-4">Amount</th>
              <th className="py-3.5 px-4">Payment Method</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Transaction Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {loading && (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  <span>Loading payment records...</span>
                </td>
              </tr>
            )}

            {!loading && filteredPayments.map((p) => {
              const isSuccess = (p.status || '').toUpperCase() === 'SUCCESS';
              return (
                <tr key={p.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3.5 px-4 font-bold text-indigo-300">Pay-#{p.id}</td>
                  <td className="py-3.5 px-4 font-bold text-white">Order-#{p.orderId}</td>
                  <td className="py-3.5 px-4 font-bold text-emerald-400">${Number(p.amount || 0).toFixed(2)}</td>
                  <td className="py-3.5 px-4 text-slate-300 font-sans">{p.paymentMethod || 'CREDIT_CARD'}</td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      isSuccess 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {isSuccess ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                      {p.status || 'SUCCESS'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-400 font-sans">
                    {p.transactionDate ? new Date(p.transactionDate).toLocaleString() : 'Just Now'}
                  </td>
                </tr>
              );
            })}

            {!loading && filteredPayments.length === 0 && (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500 font-sans">
                  No payment records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
