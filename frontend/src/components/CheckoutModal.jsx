import React, { useState, useEffect } from 'react';
import { 
  X, 
  CreditCard, 
  Truck, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  ArrowLeft,
  Smartphone,
  Banknote,
  ExternalLink,
  RotateCcw
} from 'lucide-react';

export default function CheckoutModal({
  isOpen,
  onClose,
  checkoutData,
  currentUser,
  servicesHealth = {},
  onSubmitOrder,
  onOpenOrderTracker
}) {
  const [step, setStep] = useState('FORM'); // 'FORM' | 'SUBMITTING' | 'SUCCESS' | 'FAILURE'
  const [fullName, setFullName] = useState(currentUser?.username ? `${currentUser.username.toUpperCase()} (Customer)` : 'Alice Johnson');
  const [email, setEmail] = useState(currentUser?.username ? `${currentUser.username}@omnistore.com` : 'alice@omnistore.com');
  const [shippingAddress, setShippingAddress] = useState('742 Evergreen Terrace, Springfield, IL 62704');
  const [phone, setPhone] = useState('+1 (555) 234-5678');
  const [paymentMethod, setPaymentMethod] = useState('CREDIT_CARD'); // 'CREDIT_CARD' | 'UPI' | 'COD'
  
  // Card mock inputs
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8892');
  const [cardExpiry, setCardExpiry] = useState('08/28');
  const [cardCvv, setCardCvv] = useState('842');
  const [upiId, setUpiId] = useState('alice@okaxis');

  // Response states
  const [createdOrder, setCreatedOrder] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [failedService, setFailedService] = useState(null);

  // ALWAYS reset to initial FORM view whenever modal opens or new checkout item is selected
  useEffect(() => {
    if (isOpen) {
      setStep('FORM');
      setCreatedOrder(null);
      setErrorDetails(null);
      setFailedService(null);
      if (currentUser?.username) {
        setFullName(`${currentUser.username.toUpperCase()} (Customer)`);
        setEmail(`${currentUser.username}@omnistore.com`);
      }
    }
  }, [isOpen, checkoutData]);

  if (!isOpen || !checkoutData) return null;

  const { cartItems = [], subtotal = 0, shipping = 0, discountAmount = 0, tax = 0, total = 0 } = checkoutData;

  // Active microservice faults
  const paymentFault = servicesHealth?.payment?.fault && servicesHealth.payment.fault !== 'NONE' 
    ? servicesHealth.payment.fault : null;
  const inventoryFault = servicesHealth?.inventory?.fault && servicesHealth.inventory.fault !== 'NONE' 
    ? servicesHealth.inventory.fault : null;
  const orderFault = servicesHealth?.order?.fault && servicesHealth.order.fault !== 'NONE' 
    ? servicesHealth.order.fault : null;
  const shippingFault = servicesHealth?.shipping?.fault && servicesHealth.shipping.fault !== 'NONE' 
    ? servicesHealth.shipping.fault : null;

  const handlePlaceOrder = async (e) => {
    if (e) e.preventDefault();
    setStep('SUBMITTING');
    setErrorDetails(null);
    setFailedService(null);

    // Primary product from cart (Order service schema takes productId, quantity, amount)
    const primaryItem = cartItems[0] || {};
    const primaryProduct = primaryItem.product || {};

    const orderPayload = {
      customerId: currentUser?.id || 101,
      productId: Number(primaryProduct.productId || primaryProduct.id || 101),
      quantity: Number(primaryItem.quantity || 1),
      amount: Number(total.toFixed(2)),
      shippingAddress: `${shippingAddress} (Recipient: ${fullName}, Phone: ${phone})`,
      paymentMethod: paymentMethod,
      status: 'PENDING'
    };

    try {
      const res = await onSubmitOrder(orderPayload);
      if (res && !res.error && res.data) {
        setCreatedOrder(res.data);
        setStep('SUCCESS');
      } else {
        const errMsg = res?.error || 'Order placement failed: Downstream microservice error';
        setErrorDetails(errMsg);
        
        // Diagnose which microservice caused the breakdown
        if (errMsg.toLowerCase().includes('payment') || paymentFault) {
          setFailedService('Payment Service (:8082)');
        } else if (errMsg.toLowerCase().includes('inventory') || errMsg.toLowerCase().includes('stock') || inventoryFault) {
          setFailedService('Inventory Service (:8083)');
        } else if (errMsg.toLowerCase().includes('order') || orderFault) {
          setFailedService('Order Service (:8081)');
        } else {
          setFailedService('Microservice Pipeline');
        }
        setStep('FAILURE');
      }
    } catch (err) {
      setErrorDetails(err.message || 'Network exception during checkout');
      setFailedService('Gateway Connection');
      setStep('FAILURE');
    }
  };

  const handleCloseModal = () => {
    setStep('FORM');
    setCreatedOrder(null);
    setErrorDetails(null);
    setFailedService(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">OmniStore Checkout</h2>
              <p className="text-xs text-slate-400">Real-Time Microservice Transaction Pipeline</p>
            </div>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 font-sans">
          
          {/* STEP 1: FORM */}
          {step === 'FORM' && (
            <form onSubmit={handlePlaceOrder} className="space-y-5">
              
              {/* Microservice Pre-Flight Health Radar */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    Microservice Pipeline Pre-Flight Health
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Port :8080 &rarr; Direct Services</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'order', label: 'Order :8081', fault: orderFault },
                    { key: 'inventory', label: 'Inventory :8083', fault: inventoryFault },
                    { key: 'payment', label: 'Payment :8082', fault: paymentFault },
                    { key: 'shipping', label: 'Shipping :8084', fault: shippingFault },
                  ].map(svc => {
                    const isFaulted = Boolean(svc.fault);
                    return (
                      <div 
                        key={svc.key}
                        className={`p-2 rounded-lg border text-center text-[11px] transition ${
                          isFaulted
                            ? 'bg-rose-950/40 border-rose-800/80 text-rose-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="truncate font-medium">{svc.label}</div>
                        <div className="text-[10px] mt-0.5 font-mono">
                          {isFaulted ? (
                            <span className="text-rose-400">{svc.fault} FAULT</span>
                          ) : (
                            <span className="text-emerald-400">HEALTHY</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {paymentFault && (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>
                      <strong>Warning:</strong> Payment Service has an active fault ({paymentFault}). This order is expected to fail during payment processing.
                    </span>
                  </div>
                )}
              </div>

              {/* Shipping & Contact Information */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  1. Shipping & Customer Details
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-400 mb-1">Delivery Address</label>
                    <input
                      type="text"
                      required
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  2. Payment Method
                </h3>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CREDIT_CARD')}
                    className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 text-xs font-semibold transition ${
                      paymentMethod === 'CREDIT_CARD'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Card</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('UPI')}
                    className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 text-xs font-semibold transition ${
                      paymentMethod === 'UPI'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>UPI / QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('COD')}
                    className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 text-xs font-semibold transition ${
                      paymentMethod === 'COD'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Cash on Delivery</span>
                  </button>
                </div>

                {paymentMethod === 'CREDIT_CARD' && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Card Number</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Expiry</label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">CVV</label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'UPI' && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <label className="block text-[10px] text-slate-500 mb-1">Virtual Payment Address (UPI ID)</label>
                    <input
                      type="text"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Order Total Preview & Submit Button */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="block text-[11px] text-slate-400">Total Payable</span>
                  <span className="text-xl font-black text-indigo-300 font-mono">
                    ${total.toFixed(2)}
                  </span>
                </div>

                <div className="flex items-center space-x-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 sm:flex-initial flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition cursor-pointer"
                  >
                    <span>Pay &amp; Place Order</span>
                  </button>
                </div>
              </div>

            </form>
          )}

          {/* STEP 2: SUBMITTING / PROCESSING */}
          {step === 'SUBMITTING' && (
            <div className="py-16 text-center space-y-4">
              <div className="relative inline-flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Executing Microservice Order Pipeline</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Gateway is delegating requests across Order (:8081) &rarr; Inventory (:8083) &rarr; Payment (:8082) &rarr; Shipping (:8084)...
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: FAILURE (Realistic Microservice Outage Feedback) */}
          {step === 'FAILURE' && (
            <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-800/80 space-y-5 animate-in fade-in duration-200">
              <div className="flex items-start space-x-3">
                <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 shrink-0">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <div>
                  <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 text-[10px] font-extrabold uppercase tracking-wider text-rose-300">
                    TRANSACTION REJECTED &bull; {failedService}
                  </span>
                  <h3 className="text-lg font-extrabold text-white mt-1">
                    Checkout Failed Due to Microservice Fault
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    {errorDetails}
                  </p>
                </div>
              </div>

              {/* Breakdown of What Happened in Microservice Architecture */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2">
                <div className="font-bold text-slate-200">Architecture Cascade Trace:</div>
                <ul className="space-y-1.5 text-slate-400 text-[11px]">
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>1. API Gateway routed POST /orders to Order Service (:8081).</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${failedService?.includes('Inventory') ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                    <span>2. Inventory Service (:8083) stock allocation {failedService?.includes('Inventory') ? 'FAILED' : 'checked'}.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${failedService?.includes('Payment') ? 'bg-rose-400' : 'bg-slate-500'}`} />
                    <span>3. Payment Service (:8082) transaction call {failedService?.includes('Payment') ? 'FAILED / TIMED OUT' : 'aborted'}.</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                    <span>4. Order state flagged as <strong>PAYMENT_FAILED</strong> in MongoDB Atlas.</span>
                  </li>
                </ul>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  onClick={() => setStep('FORM')}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Try Again / Change Payment</span>
                </button>

                <button
                  onClick={() => {
                    handleCloseModal();
                    if (onOpenOrderTracker) onOpenOrderTracker();
                  }}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition"
                >
                  <span>Inspect in Order Tracker</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="p-6 rounded-2xl bg-emerald-950/30 border border-emerald-800/80 space-y-5 animate-in fade-in duration-200 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4">
                <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <span className="px-2 py-0.5 rounded bg-emerald-900 border border-emerald-700 text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
                    ORDER CONFIRMED &bull; #{createdOrder?.id || 'SUCCESS'}
                  </span>
                  <h3 className="text-xl font-extrabold text-white mt-1">
                    Thank You For Your Order!
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    Order confirmed and payment verified. All microservices responded successfully.
                  </p>
                </div>
              </div>

              {/* Order Info */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2 text-left">
                <div className="grid grid-cols-2 gap-2 text-slate-300">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Order ID</span>
                    <span className="font-mono font-bold text-white">#{createdOrder?.id || '1001'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Total Paid</span>
                    <span className="font-mono font-bold text-emerald-400">${total.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Estimated Delivery</span>
                    <span className="font-semibold text-white">2-3 Business Days</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Status</span>
                    <span className="font-semibold text-emerald-400">{createdOrder?.status || 'PROCESSING'}</span>
                  </div>
                </div>
              </div>

              {shippingFault && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center space-x-2 text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    <strong>Notice:</strong> Shipping Service (:8084) is experiencing a fault. Dispatch notification is queued and will trigger automatically once restored.
                  </span>
                </div>
              )}

              {/* Navigation Action */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  onClick={handleCloseModal}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Continue Shopping
                </button>

                <button
                  onClick={() => {
                    handleCloseModal();
                    if (onOpenOrderTracker) onOpenOrderTracker(createdOrder);
                  }}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition"
                >
                  <span>Track This Order</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
