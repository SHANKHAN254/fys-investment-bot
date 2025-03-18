// main.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// ====================
// GLOBAL DATA STORAGE
// ====================
let users = {};         // Store user data keyed by their WhatsApp number (senderNumber)
let transactions = {};  // Log deposits, withdrawals, etc.
let investments = {};   // Record investments

// Admins object – the super admin (cannot be edited/removed) is fixed as 254701339573.
let admins = {
  "254701339573": { name: "Super Admin", role: "super" }
};

// API and operational configuration (editable via admin panel)
let config = {
  stk_push_url: 'https://backend.payhero.co.ke/api/v2/payments',
  transaction_status_url: 'https://backend.payhero.co.ke/api/v2/transaction-status',
  channel_id: 529,
  provider: 'm-pesa',
  callback_url: 'https://example.com/callback.php',  // Update as needed
  auth_token_stk: 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==',
  auth_token_status: 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==',
  payment_details: "Send money to 0701339573, Name: Camlus Okoth",
  deposit_min: 1,         // Minimum deposit amount is 1
  deposit_max: 75000,     // Maximum deposit amount is 75,000
  withdrawal_min: 1000,   // Example minimum withdrawal
  withdrawal_max: 500000  // Example maximum withdrawal
};

// Sessions to store conversation state per user (for the bot's state machine)
let sessions = {};

// ====================
// HELPER FUNCTIONS
// ====================
function generateDepositID() {
  return 'DEP-' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

function generateWithdrawalID() {
  return 'WD-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function generateReferralCode() {
  return "FY'S-" + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}

function isValidPhone(phone) {
  // Must start with 070 or 01 and be exactly 10 digits.
  return /^(070|01)\d{7}$/.test(phone);
}

function getKenyaTime() {
  return "🕒 " + new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" });
}

// ====================
// MPESA PAYMENT FUNCTIONS
// ====================

async function sendStkPush(amount, phone_number, customer_name, external_reference) {
  try {
    const data = {
      amount: amount,
      phone_number: phone_number,
      channel_id: config.channel_id,
      provider: config.provider,
      external_reference: external_reference,
      customer_name: customer_name,
      callback_url: config.callback_url
    };
    const response = await axios.post(config.stk_push_url, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.auth_token_stk
      }
    });
    return response.data;
  } catch (error) {
    return { error: error.message };
  }
}

async function checkTransactionStatus(reference) {
  try {
    const url = `${config.transaction_status_url}?reference=${encodeURIComponent(reference)}`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': config.auth_token_status
      }
    });
    return response.data;
  } catch (error) {
    return { error: error.message };
  }
}

// ====================
// WHATSAPP CLIENT SETUP
// ====================
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp Bot is ready!');
});

// ====================
// MESSAGE HANDLER
// ====================
client.on('message', async (message) => {
  const sender = message.from; // e.g., "12345@c.us"
  const senderNumber = sender.split('@')[0];
  const isSenderAdmin = admins[senderNumber] ? true : false;

  // Initialize session if not exists
  if (!sessions[senderNumber]) {
    sessions[senderNumber] = { state: 'none' };
  }
  let session = sessions[senderNumber];

  // Global commands: "menu" or "00" resets to main menu; "0" goes back.
  if (message.body.toLowerCase() === 'menu' || message.body === '00') {
    session.state = 'main_menu';
  }
  if (message.body === '0') {
    session.state = 'main_menu';
  }

  // Admin command: if message starts with "admin", enter admin panel (only for admins)
  if (message.body.toLowerCase().startsWith('admin')) {
    if (isSenderAdmin) {
      session.state = 'admin_main';
      client.sendMessage(sender, 
        "👑 Welcome to Admin Panel!\n" +
        "Type:\n" +
        "1. View Users\n" +
        "2. View Transactions\n" +
        "3. Update Payment Details\n" +
        "4. Change Limits\n" +
        "5. Add Admin\n" +
        "6. Approve/Reject Withdrawals\n" +
        "7. Ban User\n" +
        "Type 0 to exit Admin Panel."
      );
      return;
    } else {
      client.sendMessage(sender, "❌ You are not authorized as admin.");
      return;
    }
  }

  // If in an admin sub-state, handle admin commands.
  if (isSenderAdmin && session.state && session.state.startsWith('admin')) {
    await handleAdminCommands(message, session, senderNumber);
    return;
  }

  // ---------------------------
  // USER FLOW (Non-admin users)
  // ---------------------------
  switch (session.state) {
    case 'none':
      // If user is registered, show main menu; otherwise, start registration.
      if (users[senderNumber]) {
        session.state = 'main_menu';
        client.sendMessage(sender, 
          `Welcome back ${users[senderNumber].first_name}! ${getKenyaTime()}\n\n` +
          "Main Menu:\n" +
          "1. Invest\n" +
          "2. Check Balance\n" +
          "3. Deposit Funds\n" +
          "4. Withdraw Earnings\n" +
          "5. Change PIN\n" +
          "Type the number of your choice."
        );
      } else {
        session.state = 'register_first_name';
        client.sendMessage(sender, 
          `👋 Welcome to FY'S INVESTMENT BOT! ${getKenyaTime()}\n` +
          "Let's get you registered.\n" +
          "Please enter your first name:"
        );
      }
      break;

    // Registration Flow
    case 'register_first_name':
      session.first_name = message.body.trim();
      session.state = 'register_second_name';
      client.sendMessage(sender, "⏳ Please enter your second name:");
      break;
    case 'register_second_name':
      session.second_name = message.body.trim();
      session.state = 'register_phone';
      client.sendMessage(sender, "📞 Enter your phone number (must start with 070 or 01 and be exactly 10 digits):");
      break;
    case 'register_phone':
      {
        let phone = message.body.trim();
        if (!isValidPhone(phone)) {
          client.sendMessage(sender, "⚠️ Invalid phone number format. Please enter a valid phone number:");
          return;
        }
        session.phone = phone;
        session.state = 'register_pin';
        client.sendMessage(sender, "🔒 Create your 4-digit PIN:");
      }
      break;
    case 'register_pin':
      {
        let pin = message.body.trim();
        if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
          client.sendMessage(sender, "⚠️ PIN must be exactly 4 digits. Please re-enter:");
          return;
        }
        let referralCode = generateReferralCode();
        users[senderNumber] = {
          first_name: session.first_name,
          second_name: session.second_name,
          phone: session.phone,
          pin: pin,
          balance: 0,
          referral_code: referralCode,
          referrals: [],
          investments: [],
          banned: false
        };
        session.state = 'main_menu';
        client.sendMessage(sender, 
          `✅ Registration successful! Your referral code is ${referralCode}.\n${getKenyaTime()}\n\n` +
          "Main Menu:\n" +
          "1. Invest\n" +
          "2. Check Balance\n" +
          "3. Deposit Funds\n" +
          "4. Withdraw Earnings\n" +
          "5. Change PIN\n" +
          "Type the number of your choice."
        );
      }
      break;

    // Main Menu
    case 'main_menu':
      {
        let choice = message.body.trim();
        if (choice === '1') {
          session.state = 'invest_amount';
          client.sendMessage(sender, "💼 Enter investment amount (Min: Ksh 1000, Max: Ksh 150000):");
        } else if (choice === '2') {
          let user = users[senderNumber];
          let reply = 
            `💰 Your current balance is: Ksh ${user.balance}.\n` +
            `🔗 Your Referral Code: ${user.referral_code}\n` +
            `👥 You have referred ${user.referrals.length} user(s).`;
          if (user.referrals.length > 0) {
            reply += "\nReferred users: " + user.referrals.map(ref => {
              return users[ref] ? (users[ref].first_name + " " + users[ref].second_name) : ref;
            }).join(", ");
          }
          reply += `\n${getKenyaTime()}`;
          client.sendMessage(sender, reply);
        } else if (choice === '3') {
          session.state = 'deposit_amount';
          client.sendMessage(sender, "💵 Enter deposit amount:");
        } else if (choice === '4') {
          session.state = 'withdraw_amount';
          client.sendMessage(sender, "💸 Enter withdrawal amount (Minimum: Ksh " + config.withdrawal_min + "):");
        } else if (choice === '5') {
          session.state = 'change_pin_current';
          client.sendMessage(sender, "🔒 Enter your current PIN:");
        } else {
          client.sendMessage(sender, 
            "❌ Invalid option. Please type the number of your choice from the main menu."
          );
        }
      }
      break;

    // Investment Flow
    case 'invest_amount':
      {
        let amount = parseFloat(message.body.trim());
        if (isNaN(amount) || amount < 1000 || amount > 150000) {
          client.sendMessage(sender, "⚠️ Investment amount must be between Ksh 1000 and Ksh 150000. Please enter a valid amount:");
          return;
        }
        let user = users[senderNumber];
        if (user.balance < amount) {
          client.sendMessage(sender, `❌ Insufficient balance. Your current balance is Ksh ${user.balance}.`);
          session.state = 'main_menu';
          return;
        }
        session.invest_amount = amount;
        session.state = 'invest_confirm_pin';
        client.sendMessage(sender, "🔐 Enter your 4-digit PIN to confirm investment:");
      }
      break;
    case 'invest_confirm_pin':
      {
        let user = users[senderNumber];
        let pin = message.body.trim();
        if (pin !== user.pin) {
          client.sendMessage(sender, "⚠️ Incorrect PIN.");
          session.state = 'main_menu';
          return;
        }
        let amount = session.invest_amount;
        user.balance -= amount;
        let investment_id = "INV-" + Date.now();
        investments[investment_id] = {
          user_phone: senderNumber,
          amount: amount,
          date: getKenyaTime(),
          status: 'ONGOING'
        };
        user.investments.push(investment_id);
        client.sendMessage(sender, 
          `✅ Investment successful! You invested Ksh ${amount}. Expected return: 10% after 24 hours.\n` +
          `Investment ID: ${investment_id}.\n${getKenyaTime()} 😊`
        );
        session.state = 'main_menu';
      }
      break;

    // Deposit Flow
    case 'deposit_amount':
      {
        let amount = parseFloat(message.body.trim());
        if (isNaN(amount) || amount < config.deposit_min || amount > config.deposit_max) {
          client.sendMessage(sender, 
            `⚠️ Deposit must be between Ksh ${config.deposit_min} and Ksh ${config.deposit_max}. ` +
            `Please enter a valid amount:`
          );
          return;
        }
        session.deposit_amount = amount;
        session.state = 'deposit_initiate';
        client.sendMessage(sender, `👉 Please deposit Ksh ${amount}. ${config.payment_details}`);
        let depositID = generateDepositID();
        session.deposit_id = depositID;
        client.sendMessage(sender, `🔢 Your Deposit ID is: ${depositID}`);
        client.sendMessage(sender, "⏳ Sending STK push, please wait...");

        // Initiate STK push asynchronously
        (async () => {
          let user = users[senderNumber];
          let response = await sendStkPush(amount, user.phone, user.first_name + " " + user.second_name, depositID);
          let transaction_reference = response.reference || depositID;
          client.sendMessage(sender, "⏳ Processing payment... Please wait 20 seconds.");
          
          setTimeout(async () => {
            let statusResponse = await checkTransactionStatus(transaction_reference);
            if (statusResponse.status && statusResponse.status === 'SUCCESS') {
              user.balance += amount;
              client.sendMessage(sender, 
                `✅ Deposit successful! Your account has been credited with Ksh ${amount}.\n${getKenyaTime()} 😊`
              );
            } else {
              client.sendMessage(sender, 
                `❌ Deposit failed. Transaction status: ${statusResponse.status || 'UNKNOWN'}. Please try again.`
              );
            }
            transactions[depositID] = {
              type: 'deposit',
              amount: amount,
              status: statusResponse.status || 'UNKNOWN',
              date: getKenyaTime()
            };
          }, 20000);
        })();

        session.state = 'main_menu';
      }
      break;

    // Withdrawal Flow
    case 'withdraw_amount':
      {
        let amount = parseFloat(message.body.trim());
        if (isNaN(amount) || amount < config.withdrawal_min || amount > config.withdrawal_max) {
          client.sendMessage(sender, 
            `⚠️ Withdrawal must be between Ksh ${config.withdrawal_min} and Ksh ${config.withdrawal_max}. ` +
            `Please enter a valid amount:`
          );
          return;
        }
        let user = users[senderNumber];
        if (user.balance < amount) {
          client.sendMessage(sender, `❌ Insufficient balance. Your current balance is Ksh ${user.balance}.`);
          session.state = 'main_menu';
          return;
        }
        session.withdraw_amount = amount;
        session.state = 'withdraw_confirm_pin';
        client.sendMessage(sender, "🔐 Enter your 4-digit PIN to confirm withdrawal:");
      }
      break;
    case 'withdraw_confirm_pin':
      {
        let user = users[senderNumber];
        let pin = message.body.trim();
        if (pin !== user.pin) {
          client.sendMessage(sender, "⚠️ Incorrect PIN.");
          session.state = 'main_menu';
          return;
        }
        user.balance -= session.withdraw_amount;
        let withdrawalID = generateWithdrawalID();
        transactions[withdrawalID] = {
          type: 'withdrawal',
          amount: session.withdraw_amount,
          status: 'PENDING',
          date: getKenyaTime()
        };
        client.sendMessage(sender, 
          `✅ Withdrawal request submitted! Your Withdrawal ID is: ${withdrawalID}. ` +
          `It will be processed shortly.\n${getKenyaTime()} 😊`
        );
        session.state = 'main_menu';
      }
      break;

    // Change PIN Flow
    case 'change_pin_current':
      {
        let user = users[senderNumber];
        let currentPin = message.body.trim();
        if (currentPin !== user.pin) {
          client.sendMessage(sender, "⚠️ Incorrect current PIN.");
          session.state = 'main_menu';
          return;
        }
        session.state = 'change_pin_new';
        client.sendMessage(sender, "🔄 Enter your new 4-digit PIN:");
      }
      break;
    case 'change_pin_new':
      {
        let newPin = message.body.trim();
        if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
          client.sendMessage(sender, "⚠️ PIN must be exactly 4 digits. Please re-enter:");
          return;
        }
        users[senderNumber].pin = newPin;
        client.sendMessage(sender, "✅ PIN changed successfully!");
        session.state = 'main_menu';
      }
      break;

    default:
      session.state = 'main_menu';
      client.sendMessage(sender, 
        "Main Menu:\n" +
        "1. Invest\n" +
        "2. Check Balance\n" +
        "3. Deposit Funds\n" +
        "4. Withdraw Earnings\n" +
        "5. Change PIN\n" +
        "Type the number of your choice."
      );
      break;
  }
});

// ====================
// ADMIN PANEL FUNCTIONS
// ====================
async function handleAdminCommands(message, session, adminNumber) {
  const sender = message.from;
  let input = message.body.trim();

  if (session.state === 'admin_main') {
    switch (input) {
      case '1': // View All Users
        {
          let userList = "👥 All Users:\n";
          for (let phone in users) {
            userList += `- ${users[phone].first_name} ${users[phone].second_name} (Phone: ${phone}, Balance: Ksh ${users[phone].balance})\n`;
          }
          client.sendMessage(sender, userList);
        }
        break;
      case '2': // View Transactions
        {
          let transList = "💳 All Transactions:\n";
          for (let id in transactions) {
            let t = transactions[id];
            transList += `ID: ${id} | Type: ${t.type} | Amount: Ksh ${t.amount} | Status: ${t.status} | Date: ${t.date}\n`;
          }
          client.sendMessage(sender, transList);
        }
        break;
      case '3': // Update Payment Details
        session.state = 'admin_update_payment';
        client.sendMessage(sender, "Enter new payment details (format: Phone, Name):");
        break;
      case '4': // Change Limits
        session.state = 'admin_change_limits';
        client.sendMessage(sender, "Enter new deposit minimum:");
        break;
      case '5': // Add Admin
        session.state = 'admin_add_admin';
        client.sendMessage(sender, "Enter new admin phone number:");
        break;
      case '6': // Approve/Reject Withdrawals
        {
          let pendingWithdrawals = "";
          for (let id in transactions) {
            if (transactions[id].type === 'withdrawal' && transactions[id].status === 'PENDING') {
              pendingWithdrawals += `ID: ${id} | Amount: Ksh ${transactions[id].amount} | Date: ${transactions[id].date}\n`;
            }
          }
          if (pendingWithdrawals === "") {
            client.sendMessage(sender, "No pending withdrawal requests.");
          } else {
            session.state = 'admin_withdrawals';
            session.pendingWithdrawals = Object.keys(transactions).filter(id => 
              transactions[id].type === 'withdrawal' && transactions[id].status === 'PENDING'
            );
            client.sendMessage(sender, 
              "Pending Withdrawals:\n" + pendingWithdrawals + "\n" +
              "Type the Withdrawal ID followed by A (approve) or R (reject), e.g., WD-1234A"
            );
          }
        }
        break;
      case '7': // Ban User
        session.state = 'admin_ban_user';
        client.sendMessage(sender, "Enter user phone number to ban:");
        break;
      case '0':
        session.state = 'none';
        client.sendMessage(sender, "Exiting Admin Panel.");
        break;
      default:
        client.sendMessage(sender, 
          "❌ Invalid admin option. Please choose a valid option:\n" +
          "1. View Users\n" +
          "2. View Transactions\n" +
          "3. Update Payment Details\n" +
          "4. Change Limits\n" +
          "5. Add Admin\n" +
          "6. Approve/Reject Withdrawals\n" +
          "7. Ban User\n" +
          "0. Logout"
        );
        break;
    }
  } else if (session.state === 'admin_update_payment') {
    config.payment_details = input;
    client.sendMessage(sender, `✅ Payment details updated to: ${input}`);
    session.state = 'admin_main';
  } else if (session.state === 'admin_change_limits') {
    if (!session.newLimits) session.newLimits = {};
    if (!session.newLimits.deposit_min) {
      session.newLimits.deposit_min = input;
      client.sendMessage(sender, "Enter new deposit maximum:");
    } else if (!session.newLimits.deposit_max) {
      session.newLimits.deposit_max = input;
      client.sendMessage(sender, "Enter new withdrawal minimum:");
    } else if (!session.newLimits.withdrawal_min) {
      session.newLimits.withdrawal_min = input;
      client.sendMessage(sender, "Enter new withdrawal maximum:");
    } else {
      session.newLimits.withdrawal_max = input;
      config.deposit_min = Number(session.newLimits.deposit_min);
      config.deposit_max = Number(session.newLimits.deposit_max);
      config.withdrawal_min = Number(session.newLimits.withdrawal_min);
      config.withdrawal_max = Number(session.newLimits.withdrawal_max);
      client.sendMessage(sender, "✅ Limits updated successfully.");
      session.newLimits = null;
      session.state = 'admin_main';
    }
  } else if (session.state === 'admin_add_admin') {
    if (!session.newAdminPhone) {
      session.newAdminPhone = input;
      client.sendMessage(sender, "Enter new admin name:");
    } else {
      admins[session.newAdminPhone] = { name: input, role: 'admin' };
      client.sendMessage(sender, `✅ Admin ${input} added successfully with phone ${session.newAdminPhone}.`);
      session.newAdminPhone = null;
      session.state = 'admin_main';
    }
  } else if (session.state === 'admin_withdrawals') {
    // Expected input: e.g., WD-1234A or WD-1234R
    let withdrawalID = input.slice(0, input.length - 1);
    let decision = input.slice(-1).toUpperCase();
    if (
      transactions[withdrawalID] && 
      transactions[withdrawalID].type === 'withdrawal' && 
      transactions[withdrawalID].status === 'PENDING'
    ) {
      if (decision === 'A') {
        transactions[withdrawalID].status = 'APPROVED';
        client.sendMessage(sender, `✅ Withdrawal ${withdrawalID} approved.`);
      } else if (decision === 'R') {
        transactions[withdrawalID].status = 'REJECTED';
        client.sendMessage(sender, `❌ Withdrawal ${withdrawalID} rejected.`);
      } else {
        client.sendMessage(sender, 
          "⚠️ Invalid decision. Please append A (approve) or R (reject) to the ID."
        );
      }
    } else {
      client.sendMessage(sender, "⚠️ Withdrawal ID not found or not pending.");
    }
    session.state = 'admin_main';
  } else if (session.state === 'admin_ban_user') {
    if (!session.banUserPhone) {
      session.banUserPhone = input;
      client.sendMessage(sender, "Enter reason for ban:");
    } else {
      let userPhone = session.banUserPhone;
      if (users[userPhone]) {
        users[userPhone].banned = true;
        users[userPhone].ban_reason = input;
        client.sendMessage(sender, `🚫 User ${userPhone} banned. Reason: ${input}`);
      } else {
        client.sendMessage(sender, "❌ User not found.");
      }
      session.banUserPhone = null;
      session.state = 'admin_main';
    }
  } else {
    session.state = 'admin_main';
    client.sendMessage(sender, 
      "Returning to Admin Main Menu. Type:\n" +
      "1. View Users\n" +
      "2. View Transactions\n" +
      "3. Update Payment Details\n" +
      "4. Change Limits\n" +
      "5. Add Admin\n" +
      "6. Approve/Reject Withdrawals\n" +
      "7. Ban User\n" +
      "0. Logout"
    );
  }
}

// ====================
// INITIALIZE THE CLIENT
// ====================
client.initialize();
