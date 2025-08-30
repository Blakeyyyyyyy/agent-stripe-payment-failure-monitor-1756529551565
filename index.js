const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// Activity logs
let logs = [];
const addLog = (message) => {
  logs.push({ timestamp: new Date().toISOString(), message });
  if (logs.length > 100) logs.shift(); // Keep last 100 logs
  console.log(`[${new Date().toISOString()}] ${message}`);
};

// Gmail setup
const gmail = google.gmail('v1');

async function getGmailAuth() {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token: process.env.GMAIL_ACCESS_TOKEN,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  return auth;
}

async function sendEmail(subject, body) {
  try {
    const auth = await getGmailAuth();
    gmail.context._options.auth = auth;

    const message = [
      'To: blakeecom02@gmail.com',
      'Subject: ' + subject,
      'Content-Type: text/html; charset=utf-8',
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    addLog(`Email sent successfully to blakeecom02@gmail.com`);
    return true;
  } catch (error) {
    addLog(`Failed to send email: ${error.message}`);
    throw error;
  }
}

function formatFailureEmail(event) {
  const { type, data } = event;
  let subject, body;

  if (type === 'charge.failed') {
    const charge = data.object;
    const customer = charge.customer;
    const amount = (charge.amount / 100).toFixed(2);
    const currency = charge.currency.toUpperCase();
    
    subject = `💳 Payment Failure Alert - $${amount} ${currency}`;
    body = `
      <h2>🚨 Charge Failed</h2>
      <p><strong>Amount:</strong> $${amount} ${currency}</p>
      <p><strong>Customer ID:</strong> ${customer || 'Guest'}</p>
      <p><strong>Failure Code:</strong> ${charge.failure_code || 'Unknown'}</p>
      <p><strong>Failure Message:</strong> ${charge.failure_message || 'No details provided'}</p>
      <p><strong>Charge ID:</strong> ${charge.id}</p>
      <p><strong>Time:</strong> ${new Date(charge.created * 1000).toLocaleString()}</p>
      
      <hr>
      <p><small>View in Stripe Dashboard: <a href="https://dashboard.stripe.com/payments/${charge.id}">Open Charge</a></small></p>
    `;
  } else if (type === 'invoice.payment_failed') {
    const invoice = data.object;
    const customer = invoice.customer;
    const amount = (invoice.amount_due / 100).toFixed(2);
    const currency = invoice.currency.toUpperCase();
    
    subject = `📋 Subscription Payment Failure - $${amount} ${currency}`;
    body = `
      <h2>🚨 Invoice Payment Failed</h2>
      <p><strong>Amount:</strong> $${amount} ${currency}</p>
      <p><strong>Customer ID:</strong> ${customer}</p>
      <p><strong>Invoice Number:</strong> ${invoice.number || 'Draft'}</p>
      <p><strong>Subscription ID:</strong> ${invoice.subscription || 'N/A'}</p>
      <p><strong>Attempt Count:</strong> ${invoice.attempt_count}</p>
      <p><strong>Next Attempt:</strong> ${invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toLocaleString() : 'No retry scheduled'}</p>
      
      <hr>
      <p><small>View in Stripe Dashboard: <a href="https://dashboard.stripe.com/invoices/${invoice.id}">Open Invoice</a></small></p>
    `;
  }

  return { subject, body };
}

// Standard endpoints
app.get('/', (req, res) => {
  res.json({
    service: 'Stripe Payment Failure Monitor',
    status: 'running',
    endpoints: {
      'GET /': 'Service info',
      'GET /health': 'Health check',
      'GET /logs': 'View recent activity logs',
      'POST /webhook': 'Stripe webhook endpoint',
      'POST /test': 'Test notification'
    },
    monitoring: ['charge.failed', 'invoice.payment_failed'],
    notification_email: 'blakeecom02@gmail.com'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    logs_count: logs.length
  });
});

app.get('/logs', (req, res) => {
  res.json({ 
    logs: logs.slice(-20), // Last 20 logs
    total_logs: logs.length 
  });
});

// Stripe webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    addLog(`Received webhook: ${event.type}`);

    // Handle payment failure events
    if (event.type === 'charge.failed' || event.type === 'invoice.payment_failed') {
      try {
        const { subject, body } = formatFailureEmail(event);
        await sendEmail(subject, body);
        addLog(`Payment failure notification sent for event: ${event.type}`);
      } catch (error) {
        addLog(`Failed to send notification for ${event.type}: ${error.message}`);
        return res.status(500).json({ error: 'Failed to send notification' });
      }
    } else {
      addLog(`Ignored webhook event: ${event.type}`);
    }

    res.json({ received: true, processed: true });
  } catch (error) {
    addLog(`Webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint
app.post('/test', async (req, res) => {
  try {
    addLog('Manual test triggered');
    
    // Send test notification
    const testSubject = '🧪 Test: Stripe Payment Failure Monitor';
    const testBody = `
      <h2>✅ Test Notification</h2>
      <p>This is a test notification from your Stripe Payment Failure Monitor.</p>
      <p><strong>Service:</strong> Running properly</p>
      <p><strong>Monitoring:</strong> charge.failed, invoice.payment_failed</p>
      <p><strong>Email:</strong> blakeecom02@gmail.com</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    `;
    
    await sendEmail(testSubject, testBody);
    
    res.json({ 
      success: true, 
      message: 'Test notification sent successfully',
      email: 'blakeecom02@gmail.com'
    });
  } catch (error) {
    addLog(`Test failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  addLog(`Stripe Payment Failure Monitor started on port ${PORT}`);
});

module.exports = app;