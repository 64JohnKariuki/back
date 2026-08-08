const Intasend = require('intasend-node');
const { body, validationResult } = require('express-validator');
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

// 🌍 Environment Setup
const isSandbox = process.env.INTASEND_MODE === "sandbox";

console.log("INTA_SEND_MODE:", process.env.INTASEND_MODE);
console.log("👉 Environment:", process.env.NODE_ENV);
console.log("👉 Mode flag passed to IntaSend:", process.env.NODE_ENV !== "production");

const INTA_SEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY;
const INTA_SEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY;
const INTA_SEND_WEBHOOK_SECRET = process.env.INTASEND_WEBHOOK_SECRET;

const API_BASE_URL = isSandbox
  ? "https://sandbox.intasend.com/api/v1"
  : "https://payment.intasend.com/api/v1";

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Authorization: `Bearer ${INTA_SEND_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

// 🌐 IntaSend SDK initialization
const intasend = new Intasend(
  INTA_SEND_PUBLISHABLE_KEY,
  INTA_SEND_SECRET_KEY,
  isSandbox
);

// Webhook verification (optional but recommended)
let intasendWebhook = null;
// if (INTA_SEND_WEBHOOK_SECRET) {
//   intasendWebhook = new Intasend.Webhook(
//     INTA_SEND_PUBLISHABLE_KEY,
//     INTA_SEND_WEBHOOK_SECRET
//   );
// }

if (intasendWebhook) {
  const isVerified = intasendWebhook.verify(req.body, signature);
  if (!isVerified) {
    return res.status(401).json({ message: "Invalid webhook signature." });
  }
}

let collection = intasend.collection();
let payouts = intasend.payouts();
let wallets = intasend.wallets();
let refunds = intasend.refunds();

console.log("💡 MODE:", isSandbox ? "SANDBOX" : "LIVE");
console.log("💡 Using API base URL:", API_BASE_URL);
console.log("💡 Publishable Key:", INTA_SEND_PUBLISHABLE_KEY?.slice(0,10) + "...");
console.log("💡 Secret Key:", INTA_SEND_SECRET_KEY?.slice(0,10) + "...");
    
// A single response variable is used, declared with `let`
let response;

function generateApiRef(prefix = 'BK') {
  // uses first 12 hex chars of uuid (you can choose length)
  return (prefix + uuidv4().replace(/-/g, '').slice(0, 12)).toUpperCase();
}

exports.initPayment = async (paymentData) => {
  try {
    // Validate payment method
    if (!paymentData.payment_method) {
      throw new Error("Payment method is required.");
    }
    
    // 2. Handle CASH (no IntaSend call needed)
    if (paymentData.payment_method === "cash") {
      console.log("💵 Cash payment selected. Defaulting to success...");
      return {
        ok: true,
        status: "success",
        message: "Cash payment recorded successfully.",
        invoice_id: `CASH-${Date.now()}`, // generate a fake invoice id
        api_ref: paymentData.api_ref,
      };
    }
    
    if (paymentData.payment_method === "mpesa") {
      console.log("Initiating payment for mpesa...");
      response = await collection.mpesaStkPush(paymentData);

      console.log("Raw IntaSend response:", JSON.stringify(response, null, 2));

      // inside initPayment after calling IntaSend
      const invoice = response.invoice || response.data?.invoice || null;
      const transaction = response.transactions?.[0] || null;
      
      const providerInvoiceId = transaction?.invoice_id || invoice?.invoice_id || null;
      const providerApiRef = transaction?.api_ref || invoice?.api_ref || paymentData.api_ref || null;
      const state = transaction?.status || invoice?.state || 'PENDING';
      
      return {
        ok: true,
        status: state === 'PENDING' ? 'pending' : (['SUCCESS','PAID'].includes(state) ? 'success' : 'failed'),
        invoice_id: providerInvoiceId,
        api_ref: providerApiRef
      };
    }

    // === Other methods (card, google_pay, etc.) ===
    if (["card", "google_pay", "apple-pay", "pesalink", "cashapp"].includes(paymentData.payment_method)) {
      console.log(`Initiating ${paymentData.payment_method} checkout...`);
      response = await collection.charge(paymentData);
    }

    const invoice = response.invoice || response.data?.invoice || response.data?.data;

    if (!invoice || !invoice.invoice_id) {
      throw new Error("Invalid response from payment provider.");
    }

    if (invoice.state === "PENDING" || invoice.status === "PENDING") {
      return {
        ok: true,
        status: "pending",
        message: "Payment initiated. Awaiting confirmation...",
        invoice_url: invoice.invoice_url,
        invoice_id: invoice.invoice_id,
        api_ref: providerApiRef,
      };
      
    }

    if (invoice.state === "SUCCESS" || invoice.status === "SUCCESS") {
      return {
        ok: true,
        message: "Payment successful!",
        invoice_id: invoice.invoice_id,
        api_ref: invoice.api_ref,
        payment_link: invoice.payment_link,
        status: invoice.state,
      };
    }

    throw new Error(`Payment failed: ${invoice.failed_reason || "Unknown error"}`);

  } catch (error) {
    console.error("Payment Service Error:", error.message);
    throw new Error(error.message); // Rethrow the error for handling in the calling function
  }
};

exports.createPayment = async (req, res) => {
  const { clientName, email, phone, amount, currency, paymentMethod,  redirect_url } = req.body;
  
  // Validate input fields
  await body('clientName').notEmpty().withMessage('Client name is required.').run(req);
  await body('email').isEmail().withMessage('Valid email is required.').run(req);
  await body('phone').notEmpty().withMessage('Phone number is required.').run(req);
  await body('amount').isNumeric().withMessage('Amount must be a number.').run(req);
  await body('currency').equals('KES').withMessage('Currency must be KES.').run(req);
  await body('paymentMethod').notEmpty().withMessage('Payment method is required.').run(req);
  await body('redirect_url').notEmpty().withMessage('Redirect Url is required.').run(req);
  //await body('host').isURL().withMessage('Valid host URL is required.').run(req);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // generate canonical api_ref on server
  const serverApiRef = generateApiRef();

  const paymentData = {
    client_name: clientName,
    email,
    phone_number: phone,
    amount,
    currency,
    payment_method: paymentMethod,
    api_ref: serverApiRef,
    redirect_url: redirect_url,
    //host: host,
  };

  try {
    const paymentResult = await exports.initPayment(paymentData);
    
    // Save provider ids returned by IntaSend (prefer returned api_ref/invoice_id)
    const providerApiRef = paymentResult.api_ref || serverApiRef;
    const providerInvoiceId = paymentResult.invoice_id || null;

    // Persist to DB: update your pending booking with providerInvoiceId/api_ref
    // await db.Booking.update({ invoice_id: providerInvoiceId, api_ref: providerApiRef }, { where: { api_ref: serverApiRef } });

    // return the useful values to the client
    return res.status(200).json({
      ok: true,
      ...paymentResult,
      api_ref: providerApiRef,
      invoice_id: providerInvoiceId,
    });
  } catch (error) {
    console.error("Payment Error:", error);
  
    if (error.response?.status === 429) {
      console.warn("Rate limit hit:", error.response.data);
      return res.status(429).json({ message: "Rate limit exceeded. Please try again later." });
    } else if (error.response?.status === 500) {
      return res.status(500).json({ message: "Payment gateway error: " + error.message });
    } else {
      return res.status(500).json({ message: "Server error: " + error.message });
    }
  }
};

// New function for handling client-side polling
exports.paymentStatusCheck = async (req, res) => {
  console.log("👉 Incoming payment status check request");
  console.log("req.params:", req.params);
  console.log("req.query:", req.query);
  
  const { invoice_id, api_ref } = req.query; // ✅ invoiceId

  if (!invoice_id && !api_ref) {
    console.warn("⚠️ No api_ref or invoice_id provided.");
    return res.status(400).json({ status: 'error', message: 'Either api_ref or invoice_id is required.' });
  }

  try {
    let response = null;
    let transaction = null;
    console.log("Checking status:", { invoice_id, api_ref });

    // 1️⃣ Try invoice lookup first
    if (invoice_id) {
      try {
        response = await intasend.invoices.detail(invoice_id);
        console.log("🔎 Invoice lookup:", JSON.stringify(response, null, 2));
        transaction = response?.transactions?.[0] || null;
      } catch (err) {
        console.warn("Invoice lookup failed:", err.response?.data || err.message);
      }
    }
    
    // 2️⃣ If no transaction yet and api_ref exists → try collection lookup
    if (!transaction && api_ref) {
      try {
        response = await collection.status({ api_ref });
        console.log("🔎 Collection lookup:", JSON.stringify(response, null, 2));
        transaction = response?.transactions?.[0] || null;
      } catch (err) {
        console.warn("Collection lookup failed:", err.response?.data || err.message);
      }
    }
    
    // 3️⃣ Determine status dynamically
    let clientStatus = "pending";
    let message = "Transaction is still pending.";
    
    if (transaction) {
      const tStatus = transaction.status;
      if (["SUCCESS", "PAID"].includes(tStatus)) clientStatus = "success";
      if (["FAILED", "CANCELLED"].includes(tStatus)) clientStatus = "failed";
      if (tStatus === "TIMEOUT") clientStatus = "timeout";
      message = `Transaction status: ${clientStatus}`;
    } else if (response?.invoice?.state || response?.state) {
      const state = response.invoice?.state || response.state;
      if (["SUCCESS", "PAID"].includes(state)) clientStatus = "success";
      if (["FAILED", "CANCELLED"].includes(state)) clientStatus = "failed";
      if (state === "PENDING") clientStatus = "pending";
      message = `Invoice state: ${state}`;
    } else {
      clientStatus = "unknown";
      message = "Transaction not found yet.";
    }
    
    console.log("Final status:", { clientStatus, message });
    return res.status(200).json({
      status: clientStatus,
      invoice_id: invoice_id || response?.invoice?.invoice_id || response?.invoice_id || null,
      api_ref: api_ref || response?.invoice?.api_ref || response?.api_ref || null,
      message,
      transaction: transaction || null
    });

  } catch (error) {
    console.error("❌ Error checking payment status:", error.response?.data || error.message || error);
    return res.status(500).json({
      status: 'error',
      message: "An internal server error occurred.",
      details: error.response?.data || error.message
    });
  }
};

exports.paymentStatusWebhook = async (req, res) => {
  // 🚨 IMPORTANT: Validate the webhook signature
  const signature = req.headers['x-intasend-signature'];
  try {
    const isVerified = intasendWebhook.verify(req.body, signature);
    if (!isVerified) {
      console.error("Webhook signature verification failed.");
      return res.status(401).json({ message: "Invalid webhook signature." });
    }
    console.log("Webhook signature verified.");
  } catch (error) {
    console.error("Webhook verification error:", error);
    return res.status(401).json({ message: "Webhook verification failed." });
  }

  // Use a cleaner way to get the API reference
  const apiRef = req.body?.data?.invoice?.api_ref || req.body?.invoice?.api_ref;

  if (!apiRef) {
    console.error("Webhook received with no API reference:", req.body);
    return res.status(400).json({ message: "API reference is required." });
  }

  try {
    // 🔍 This section of the code is likely correct.
    const response = await collection.status({ api_ref: apiRef });
    console.log("Webhook Response:", response);

    const transaction = response?.transactions?.[0];

    if (!response || !response.transactions || response.transactions.length === 0) {
      return res.status(404).json({ message: "No transactions found." });
    }

    if (!transaction) {
      return res.status(404).json({ message: "No transaction found." });
    }

    return res.status(200).json({
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      invoice_id: transaction.invoice_id,
      invoice_url: transaction.invoice_url,
    });

  } catch (error) {
    console.error("Error processing webhook:", error);
    return res.status(500).json({ message: "Error processing webhook." });
  }
};

// Payment Callback
exports.paymentCallback = async (req, res) => {
    const { invoiceId, status } = req.body;
    if (!invoiceId || !status) {
        return res.status(400).json({ message: "Invoice ID and status are required." });
    }
    try {
        const response = await collection.status(invoiceId);
        
        if (response.status === status) {
            // Update the payment status in your database
            // Assuming there's a function to update the payment status
            await updatePaymentStatus(invoiceId, status);
            res.status(200).json({ success: true, message: "Payment status updated successfully." });
        } else {
            res.status(400).json({ success: false, message: "Payment status mismatch." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Check Payment Status
exports.checkPaymentStatus = async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const response = await collection.status(invoiceId);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

//Payouts Refactored
exports.processPayout = async (req, res) => {
    try {
      const { transactions, currency, requiresApproval } = req.body;
  
      if (!transactions || !currency) {
        return res.status(400).json({ error: "Transactions and currency are required." });
      }
  
      const response = await payouts.mpesa({
        transactions,
        currency,
        requires_approval: requiresApproval ?? false
      });
  
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Payout error:", err);
      res.status(500).json({ error: "Failed to process payout", details: err });
    }
};
  
exports.processBankPayout = async (req, res) => {
    try {
      const { transactions, currency, requiresApproval } = req.body;
  
      if (!transactions || !currency) {
        return res.status(400).json({ error: "Transactions and currency are required." });
      }
  
      const response = await payouts.bank({
        transactions,
        currency,
        requires_approval: requiresApproval ?? false
      });
  
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Bank payout error:", err);
      res.status(500).json({ error: "Failed to process bank payout", details: err });
    }
};

// Wallets Refactored
exports.createWallet = async (req, res) => {
    try {
      const { label, walletType, currency, canDisburse } = req.body;
  
      if (!label || !walletType || !currency) {
        return res.status(400).json({ error: "Label, wallet type, and currency are required." });
      }
  
      const response = await wallets.create({
        label,
        wallet_type: walletType,
        currency,
        can_disburse: canDisburse ?? true
      });
  
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Wallet creation error:", err);
      res.status(500).json({ error: "Failed to create wallet", details: err });
    }
};
  
exports.walletTransaction = async (req, res) => {
    try {
      const { walletId } = req.params;
  
      if (!walletId) {
        return res.status(400).json({ error: "Wallet ID is required." });
      }
  
      const response = await wallets.transactions(walletId);
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Wallet transaction error:", err);
      res.status(500).json({ error: "Failed to fetch wallet transactions", details: err });
    }
};
  
exports.fundWalletMPesa = async (req, res) => {
    try {
      const { firstName, lastName, email, amount, phoneNumber, apiRef, walletId } = req.body;
  
      if (!firstName || !lastName || !email || !amount || !phoneNumber || !apiRef || !walletId) {
        return res.status(400).json({ error: "All fields are required." });
      }
  
      const response = await wallets.fundMPesa({
        first_name: firstName,
        last_name: lastName,
        email,
        amount,
        phone_number: phoneNumber,
        api_ref: apiRef,
        wallet_id: walletId
      });
  
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Fund wallet error:", err);
      res.status(500).json({ error: "Failed to fund wallet", details: err });
    }
};
  
// Refunds Refactored
exports.processRefund = async (req, res) => {
    try {
      const { invoice, amount, reason, reasonDetails } = req.body;
  
      if (!invoice || !amount || !reason) {
        return res.status(400).json({ error: "Invoice, amount, and reason are required." });
      }
  
      const response = await refunds.create({
        invoice,
        amount,
        reason,
        reason_details: reasonDetails
      });
  
      res.status(200).json(response);
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error("Refund error:", err);
      res.status(500).json({ error: "Failed to process refund", details: err });
    }
};

exports.initiatePayout = async (req, res) => {
    // Implementation
};
