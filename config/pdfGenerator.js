const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Ensure invoices directory exists
const invoicesDir = path.join(__dirname, "../invoices");
if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
    console.log("✅ Invoices directory created at:", invoicesDir);
}

// Define your base URL (adjust according to your server setup)
const BASE_URL = process.env.BASE_URL || "https://launit.com/invoices";

function createInvoice(bookingDetails) {
    return new Promise((resolve, reject) => {
        try {
            console.log("📄 Starting invoice generation for:", bookingDetails.invoice_nr);

            // Validate required fields
            if (!bookingDetails || !bookingDetails.invoice_nr) {
                throw new Error("Missing invoice_nr in booking details");
            }

            if (!bookingDetails.client || !bookingDetails.client.name) {
                throw new Error("Missing client information");
            }

            if (!bookingDetails.services || bookingDetails.services.length === 0) {
                throw new Error("Missing services information");
            }

            // Calculate expiration date (30 days from now)
            const expirationDays = 30;
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + expirationDays);

            // Define the invoice file name and path
            const invoiceFileName = `invoice_${bookingDetails.invoice_nr}.pdf`;
            const invoicePath = path.join(invoicesDir, invoiceFileName);
            
            console.log("💾 Saving invoice to:", invoicePath);

            // Create a new PDF document
            const doc = new PDFDocument({ size: "A4", margin: 50 });
            
            // Create write stream
            const writeStream = fs.createWriteStream(invoicePath);
            
            // Pipe PDF to file
            doc.pipe(writeStream);

            // Generate PDF content
            generateHeader(doc);
            generateCustomerInformation(doc, bookingDetails);
            generateInvoiceTable(doc, bookingDetails);
            generateFooter(doc);
            
            // Finalize PDF
            doc.end();
            
            // Wait for the file to be written
            writeStream.on('finish', () => {
                console.log("✅ Invoice PDF created successfully");

                try {
                    // Store invoice metadata including expiration date
                    const metadata = {
                        invoiceNumber: bookingDetails.invoice_nr,
                        filePath: invoicePath,
                        createdAt: new Date().toISOString(),
                        expiresAt: expirationDate.toISOString(),
                        clientName: bookingDetails.client.name,
                        amount: bookingDetails.subtotal,
                    };

                    // Save metadata as a JSON file
                    const metadataPath = path.join(invoicesDir, `invoice_${bookingDetails.invoice_nr}.json`);
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                    console.log("✅ Invoice metadata saved");

                    // Generate the Invoice URL
                    const invoiceUrl = `${BASE_URL}/${invoiceFileName}`;
                    
                    resolve({
                        url: invoiceUrl,
                        path: invoicePath,
                        fileName: invoiceFileName,
                    });
                } catch (metadataError) {
                    console.error("⚠️ Failed to save metadata:", metadataError.message);
                    // Still resolve with invoice URL even if metadata fails
                    const invoiceUrl = `${BASE_URL}/${invoiceFileName}`;
                    resolve({
                        url: invoiceUrl,
                        path: invoicePath,
                        fileName: invoiceFileName,
                    });
                }
            });

            writeStream.on('error', (error) => {
                console.error("❌ Error writing PDF:", error.message);
                reject(new Error(`Failed to write invoice PDF: ${error.message}`));
            });

        } catch (error) {
            console.error("❌ Error creating invoice:", error.message);
            reject(error);
        }
    });
}

function generateHeader(doc) {
    const logoPath = path.join(__dirname, "../images/Logos/logo.png");
    
    // Check if logo exists before adding it
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 50 });
    } else {
        console.warn("⚠️ Logo not found at:", logoPath);
        // Add company name as fallback
        doc
            .fillColor("#444444")
            .fontSize(16)
            .text("LC", 50, 45, { width: 50 });
    }

    doc
        .fillColor("#444444")
        .fontSize(10)
        .text("Launit Creatives Ltd.", 200, 50, { align: "right" })
        .text("Nakuru City", 200, 65, { align: "right" })
        .text("Kenya, KE, 20100", 200, 80, { align: "right" })
        .moveDown();
}

function generateCustomerInformation(doc, bookingDetails) {
    doc
        .fillColor("#444444")
        .fontSize(20)
        .text("Invoice", 50, 160);

    generateHr(doc, 185);

    const customerInformationTop = 200;

    doc
        .fontSize(10)
        .text("Invoice Number:", 50, customerInformationTop)
        .font("Helvetica-Bold")
        .text(bookingDetails.invoice_nr, 150, customerInformationTop)
        .font("Helvetica")
        .text("Invoice Date:", 50, customerInformationTop + 15)
        .text(formatDate(new Date(bookingDetails.createdAt || new Date())), 150, customerInformationTop + 15)
        .text("Balance Due:", 50, customerInformationTop + 30)
        .text(
            formatCurrency((bookingDetails.subtotal || 0) - (bookingDetails.paid || 0)), 
            150, 
            customerInformationTop + 30
        )
        .font("Helvetica-Bold")
        .text(bookingDetails.client.name || "N/A", 300, customerInformationTop)
        .font("Helvetica")
        .text(bookingDetails.client.address || "N/A", 300, customerInformationTop + 15)
        .text(
            `${bookingDetails.client.city || "N/A"}, ${bookingDetails.client.state || "KE"}, ${bookingDetails.client.country || "Kenya"}`, 
            300, 
            customerInformationTop + 30
        )
        .moveDown();

    generateHr(doc, 252);
}

function generateInvoiceTable(doc, bookingDetails) {
    let i;
    const invoiceTableTop = 330;
    
    doc.font("Helvetica-Bold");
    generateTableRow(
        doc, 
        invoiceTableTop, 
        "Item", 
        "Description", 
        "Unit Cost", 
        "Quantity", 
        "Line Total"
    );
    generateHr(doc, invoiceTableTop + 20);
    doc.font("Helvetica");

    for (i = 0; i < bookingDetails.services.length; i++) {
        const item = bookingDetails.services[i];
        const position = invoiceTableTop + (i + 1) * 30;
        generateTableRow(
            doc, 
            position, 
            item.service || "Service", 
            item.description || "N/A", 
            formatCurrency((item.amount || 0) / (item.quantity || 1)), 
            item.quantity || 1, 
            formatCurrency(item.amount || 0)
        );
        generateHr(doc, position + 20);
    }

    const subtotalPosition = invoiceTableTop + (i + 1) * 30;
    generateTableRow(
        doc, 
        subtotalPosition, 
        "", 
        "", 
        "Subtotal", 
        "", 
        formatCurrency(bookingDetails.subtotal || 0)
    );

    const paidToDatePosition = subtotalPosition + 20;
    generateTableRow(
        doc, 
        paidToDatePosition, 
        "", 
        "", 
        "Paid To Date", 
        "", 
        formatCurrency(bookingDetails.paid || 0)
    );

    const duePosition = paidToDatePosition + 25;
    doc.font("Helvetica-Bold");
    generateTableRow(
        doc, 
        duePosition, 
        "", 
        "", 
        "Balance Due", 
        "", 
        formatCurrency((bookingDetails.subtotal || 0) - (bookingDetails.paid || 0))
    );
    doc.font("Helvetica");
}

function generateFooter(doc) {
    doc
        .fontSize(10)
        .text(
            "Payment is due within 15 days. Thank you for your business.", 
            50, 
            780, 
            { align: "center", width: 500 }
        );
}

function generateTableRow(doc, y, item, description, unitCost, quantity, lineTotal) {
    const descriptionWidth = 150;
    
    // Handle description wrapping
    let displayDescription = description;
    if (typeof description === 'string' && description.length > 50) {
        // Truncate long descriptions
        displayDescription = description.substring(0, 47) + "...";
    }

    doc
        .fontSize(10)
        .text(item, 50, y)
        .text(displayDescription, 150, y, { width: descriptionWidth, align: "left" })
        .text(unitCost, 280, y, { width: 90, align: "right" })
        .text(String(quantity), 370, y, { width: 90, align: "right" })
        .text(lineTotal, 0, y, { align: "right" });
}

function generateHr(doc, y) {
    doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, y)
        .lineTo(550, y)
        .stroke();
}

function formatCurrency(amount) {
    // Handle cents vs whole currency
    const value = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
    
    // If value is very small (< 10), assume it's in whole currency units
    // If value is large (> 1000), assume it's in cents
    if (value > 1000) {
        return "KES " + (value / 100).toFixed(2);
    } else {
        return "KES " + value.toFixed(2);
    }
}

function formatDate(date) {
    const d = new Date(date);
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return `${year}/${month}/${day}`;
}

module.exports = { createInvoice };