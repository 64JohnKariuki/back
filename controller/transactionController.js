const transactionModel = require("../models/transactionModel");

exports.createTransaction = (req, res) => {
  const { customer_number, mpesa_ref, amount } = req.body;

  // Ensure all required fields are present
  if (!customer_number || !mpesa_ref || !amount) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const transactionData = {
    customer_number,
    mpesa_ref,
    amount,
  };

  transactionModel.Transaction.create(transactionData, (err, result) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Error creating transaction." });
    }
    res.status(201).json({
      message: "Transaction created successfully",
      transactionId: result.insertId,
    });
  });
};

exports.getAllTransactions = (req, res) => {
  transactionModel.Transaction.find((err, result) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Error fetching transactions." });
    }
    res.status(200).json(result);
  });
};

exports.getTransactionById = (req, res) => {
  const transactionId = req.params.id;
  transactionModel.Transaction.findById(transactionId, (err, result) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ message: "Error fetching transaction." });
    }
    if (!result) {
      return res.status(404).json({ message: "Transaction not found." });
    }
    res.status(200).json(result);
  });
};
