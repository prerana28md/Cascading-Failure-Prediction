import React, { useState } from 'react';
import { Boxes, Plus, RefreshCw, MinusCircle, Tag, DollarSign, AlertCircle, CheckCircle2, X } from 'lucide-react';

export default function InventoryList({ inventory, loading, error, onRefresh, onCreateItem, onDeductStock }) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isDeductOpen, setIsDeductOpen] = useState(false);

  // Form states for Add Product
  const [newProductId, setNewProductId] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newQuantity, setNewQuantity] = useState('');

  // Form states for Deduct Stock
  const [deductProductId, setDeductProductId] = useState('');
  const [deductQuantity, setDeductQuantity] = useState(1);
  const [actionStatus, setActionStatus] = useState(null);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setActionStatus(null);
    const item = {
      productId: Number(newProductId) || Math.floor(100 + Math.random() * 900),
      productName: newProductName,
      price: Number(newPrice),
      quantity: Number(newQuantity)
    };
    const res = await onCreateItem(item);
    if (res && !res.error) {
      setActionStatus({ success: true, message: `Product "${newProductName}" added to inventory!` });
      setIsAddOpen(false);
      setNewProductName(''); setNewPrice(''); setNewQuantity(''); setNewProductId('');
    } else {
      setActionStatus({ success: false, message: res?.error || 'Failed to add product.' });
    }
  };

  const handleDeductSubmit = async (e) => {
    e.preventDefault();
    setActionStatus(null);
    const res = await onDeductStock(Number(deductProductId), Number(deductQuantity));
    if (res && !res.error) {
      setActionStatus({ success: true, message: `Deducted ${deductQuantity} units for Product #${deductProductId}` });
      setIsDeductOpen(false);
    } else {
      setActionStatus({ success: false, message: res?.error || 'Failed to deduct stock.' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <Boxes className="w-4 h-4" />
            <span>Inventory Microservice (/inventory)</span>
          </div>
          <h2 className="text-xl font-bold text-white">Stock & Inventory Management</h2>
          <p className="text-slate-400 text-xs">
            Manage product catalog, check real-time stock levels, add new stock, or test stock deduction endpoints.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onRefresh}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setIsDeductOpen(true)}
            className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 text-xs font-semibold transition"
          >
            <MinusCircle className="w-3.5 h-3.5" />
            <span>Test Deduct</span>
          </button>

          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Item</span>
          </button>
        </div>
      </div>

      {actionStatus && (
        <div className={`p-4 rounded-xl text-xs flex items-center space-x-3 ${
          actionStatus.success 
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' 
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          {actionStatus.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{actionStatus.message}</span>
        </div>
      )}

      {/* Inventory Table */}
      <div className="overflow-x-auto rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3.5 px-4">Database ID</th>
              <th className="py-3.5 px-4">Product ID</th>
              <th className="py-3.5 px-4">Product Name</th>
              <th className="py-3.5 px-4">Unit Price</th>
              <th className="py-3.5 px-4">Stock Quantity</th>
              <th className="py-3.5 px-4">Stock Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {loading && (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                  <span>Loading inventory items...</span>
                </td>
              </tr>
            )}

            {!loading && (inventory || []).map((item) => {
              const qty = item.quantity || 0;
              return (
                <tr key={item.id || item.productId} className="hover:bg-slate-800/40 transition">
                  <td className="py-3.5 px-4 text-slate-500">#{item.id}</td>
                  <td className="py-3.5 px-4 font-bold text-indigo-300">Prod-{item.productId}</td>
                  <td className="py-3.5 px-4 font-sans font-semibold text-white">{item.productName}</td>
                  <td className="py-3.5 px-4 font-bold text-emerald-400">${Number(item.price || 0).toFixed(2)}</td>
                  <td className="py-3.5 px-4 font-bold text-white">{qty} units</td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      qty > 10 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : qty > 0
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {qty > 10 ? 'IN STOCK' : qty > 0 ? 'LOW STOCK' : 'OUT OF STOCK'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center">
                <Plus className="w-4 h-4 mr-2 text-indigo-400" />
                Add Inventory Product
              </h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Product ID</label>
                <input
                  type="number"
                  placeholder="e.g. 106"
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Product Name</label>
                <input
                  type="text"
                  placeholder="e.g. Smart Watch Series 7"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="149.99"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Initial Quantity</label>
                  <input
                    type="number"
                    placeholder="50"
                    value={newQuantity}
                    onChange={(e) => setNewQuantity(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button type="button" onClick={() => setIsAddOpen(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deduct Stock Modal */}
      {isDeductOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center">
                <MinusCircle className="w-4 h-4 mr-2 text-amber-400" />
                Test POST /inventory/deduct
              </h3>
              <button onClick={() => setIsDeductOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDeductSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Select Product ID</label>
                <select
                  value={deductProductId}
                  onChange={(e) => setDeductProductId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                >
                  <option value="">-- Choose Product --</option>
                  {(inventory || []).map(item => (
                    <option key={item.id || item.productId} value={item.productId}>
                      Prod-{item.productId}: {item.productName} (Current: {item.quantity})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Quantity to Deduct</label>
                <input
                  type="number"
                  min="1"
                  value={deductQuantity}
                  onChange={(e) => setDeductQuantity(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button type="button" onClick={() => setIsDeductOpen(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold">
                  Execute Deduct
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
