const Intasend = require('intasend-node');

// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

let is = new Intasend(
    process.env.INTASEND_PUBLISHABLE_KEY,
    process.env.INTASEND_SECRET_KEY,
    false, // Set to false in production
);

let collection = is.collection();
let payouts = is.payouts();
let wallets = is.wallets();
let refunds = is.refunds();

// Create Payment Controller
exports.createPayment = async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        amount,
        currency,
        apiRef,
        host,
        paymentMethod
      } = req.body;
  
      // Log the request body
      console.log("Incoming Payment Request:", req.body);
  
      // Validate all required fields
      if (
        !name ||
        !email ||
        !phone ||
        !amount ||
        !currency ||
        !apiRef ||
        !host ||
        !paymentMethod
      ) {
        return res.status(400).json({ error: "All fields are required." });
      }
  
      // Prepare payment data
      const paymentData = {
        name,
        email,
        phone_number: phone,
        amount,
        currency: currency.toUpperCase(), // Ensure it's 'KES'
        api_ref: apiRef,
        host: "http://localhost:5173/book", // Should match your frontend origin or domain
      };
  
      let paynentResponse;
  
      if (paymentMethod === "mpesa") {
        // STK Push doesn't accept redirect_url
        paynentResponse = await collection.mpesaStkPush(paymentData);
        if (paynentResponse?.checkout_url) {
          return res.json({ checkout_url: paynentResponse.checkout_url });
        }
      } else if (
        paymentMethod === "bank" ||
        paymentMethod === "google-pay" ||
        paymentMethod === "apple-pay"
      ) {
        // Add redirect_url for charge()
        paynentResponse = await collection.charge({
          ...paymentData,
          redirect_url: host,
        });
        if (paynentResponse?.url) {
          return res.json({ checkout_url: paynentResponse.url });
        }
      } else {
        return res.status(400).json({ error: "Unsupported payment method." });
      }
  
      // If response did not contain a URL
      console.error("IntaSend returned an unexpected response:", response);
      return res.status(500).json({
        error: "Failed to initiate payment. Please try again later.",
        details: response,
      });
  
    } catch (error) {
      // Handle IntaSend rate limits or general API errors
      if (error.response?.status === 429) {
        console.warn("Rate limit hit:", error.response.data);
        return res.status(429).json({
          error: "Too many requests. Please wait a moment and try again.",
        });
      }
  
      console.error("Unexpected server error:", error.response?.data || error.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }
};

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

exports.checkPaymentStatus = async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const response = await collection.status(invoiceId);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.initiateBankCharge = async (req, res) => {
    const { firstName, lastName, email, amount, phoneNumber, apiRef, redirectUrl } = req.body;
    if (!firstName || !lastName || !email || !amount || !phoneNumber || !apiRef || !redirectUrl) {
        return res.status(400).json({ message: "All fields are required." });
    }
    try {
        const response = await collection.charge({
            first_name: firstName,
            last_name: lastName,
            email: email,
            host: 'https://launit.com',
            amount: amount,
            currency: 'KES', // Assuming the currency is KES for this example
            api_ref: apiRef,
            redirect_url: redirectUrl
        });
        res.status(200).json({ success: true, checkoutUrl: response.url });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.processPayout = async (req, res) => {
    const { transactions, currency, requiresApproval } = req.body;
    try {
        const response = await payouts.mpesa({ currency, requires_approval: requiresApproval, transactions });
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.processBankPayout = async (req, res) => {
    const { transactions, currency, requiresApproval } = req.body;
    try {
        const response = await payouts.bank({ currency, requires_approval: requiresApproval, transactions });
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createWallet = async (req, res) => {
    try {
        const response = await wallets.create({ label: 'NodeJS-SDK-TEST', wallet_type: 'WORKING', currency: 'KES', can_disburse: true });
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.walletTransaction = async (req, res) => {
    const { walletId } = req.params;
    try {
        const response = await wallets.transactions(walletId);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.fundWalletMPesa = async (req, res) => {
    const { firstName, lastName, email, amount, phoneNumber, apiRef, walletId } = req.body;
    try {
        const response = await wallets.fundMPesa({ first_name: firstName, last_name: lastName, email, amount, phone_number: phoneNumber, api_ref: apiRef, wallet_id: walletId });
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.processRefund = async (req, res) => {
    const { invoice, amount, reason, reasonDetails } = req.body;
    try {
        const response = await refunds.create({ invoice, amount, reason, reason_details: reasonDetails });
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.initiatePayout = async (req, res) => {
    // Implementation
};
