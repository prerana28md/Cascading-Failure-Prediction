import React, { useState, useEffect } from 'react';
import { PlusCircle, ShoppingBag, User, Hash, DollarSign, MapPin, CheckCircle, AlertTriangle, X, Loader2, AlertCircle } from 'lucide-react';

export default function CreateOrderModal({ 
  isOpen, 
  onClose, 
  selectedProduct, 
  inventory, 
  servicesHealth = {}, 
  activeFaults = [], 
  onSubmitOrder 
}) {
  const [productId, setProductId] = useState('');
  const [customerId, setCustomerId] = useState('101');
  const [quantity, setQuantity] = useState(1);
  const [shippingAddress, setShippingAddress] = useState('742 Evergreen Terrace, Springfield');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState(null);

  useEffect(() => {
    if (selectedProduct) {
      setProductId(selectedProduct.productId || selectedProduct.id || '');
    } else if (inventory && inventory.length > 0) {
      setProductId(inventory[0].productId || inventory[0].id || '');
    }
  }, [selectedProduct, inventory]);

  const activeProduct = inventory?.find(p => String(p.productId) === String(productId) || String(p.id) === String(productId));
  const unitPrice = activeProduct ? Number(activeProduct.price || 0) : 99.99;
  const calculatedTotal = (unitPrice * Number(quantity)).toFixed(2);

  // Check if critical dependencies have active faults
  const paymentFault = servicesHealth?.payment?.fault && servicesHealth.payment.fault !== 'NONE' ? servicesHealth.payment.fault : null;
  const inventoryFault = servicesHealth?.inventory?.fault && servicesHealth.inventory.fault !== 'NONE' ? servicesHealth.inventory.fault : null;
  const orderFault = servicesHealth?.order?.fault && servicesHealth.order.fault !== 'NONE' ? servicesHealth.order.fault : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResultMessage(null);

    const orderPayload = {
      customerId: Number(customerId) || 101,
      productId: Number(productId) || 101,
      quantity: Number(quantity) || 1,
      amount: Number(calculatedTotal),
      shippingAddress: shippingAddress,
      status: 'PENDING'
    };

    try {
      const res = await onSubmitOrder(orderPayload);
      setIsSubmitting(false);
      if (res && !res.error && res.data) {
        setResultMessage({
          success: true,
          text: `Order #${res.data?.id || 'SUCCESS'} placed! Cascading flows triggered across Order, Payment, Shipping & Notification services.`
        });
        setTimeout(() => {
          if (onClose) onClose();
        }, 1800);
      } else {
        const errorDetail = res?.error || 'Failed to place order: Downstream microservice error.';
        setResultMessage({
          success: false,
          text: errorDetail
        });
      }
    } catch (err) {
      setIsSubmitting(false);
      setResultMessage({
        success: false,
        text: err.message || 'An error occurred while creating order.'
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl shadow-indigo-500/10">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Create New Order</h2>
              <p className="text-xs text-slate-400">Triggers POST /orders via API Gateway</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning if dependencies are currently faulted */}
        {(paymentFault || inventoryFault || orderFault) && (
          <div className="mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-1">
            <div className="flex items-center space-x-2 font-bold text-amber-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Downstream Service Outage Detected</span>
            </div>
            <p>
              {paymentFault && `• Payment Service is currently ${paymentFault}. Payment step during checkout will fail. `}
              {inventoryFault && `• Inventory Service is currently ${inventoryFault}. Stock reservation may fail. `}
              {orderFault && `• Order Service is currently ${orderFault}. Request may be rejected. `}
            </p>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Select Product */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center">
              <ShoppingBag className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              Select Product
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {inventory?.map((item) => (
                <option key={item.id || item.productId} value={item.productId}>
                  {item.productName} — ${Number(item.price).toFixed(2)} (Stock: {item.quantity})
                </option>
              ))}
              {!inventory?.length && (
                <option value="101">Wireless Headphones — $199.99</option>
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Customer ID */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center">
                <User className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                Customer ID
              </label>
              <input
                type="number"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center">
                <Hash className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                Quantity
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          {/* Shipping Address */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center">
              <MapPin className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              Delivery Shipping Address
            </label>
            <input
              type="text"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Calculated Total Box */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>Calculated Total:</span>
            </div>
            <span className="text-lg font-extrabold text-indigo-300 font-mono">
              ${calculatedTotal}
            </span>
          </div>

          {/* Feedback Status */}
          {resultMessage && (
            <div className={`p-4 rounded-xl text-xs flex items-start space-x-3 ${
              resultMessage.success 
                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300' 
                : 'bg-rose-500/20 border border-rose-500/40 text-rose-200'
            }`}>
              {resultMessage.success ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <div className="font-bold text-sm">
                  {resultMessage.success ? 'Order Processed Successfully' : 'Order Processing Failed'}
                </div>
                <div className="text-slate-300">{resultMessage.text}</div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting Order...</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Submit Order</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
