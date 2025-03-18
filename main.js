/**
 * FY'S INVESTMENT BOT
 *
 * This bot is built using whatsapp-web.js. It supports a full registration process,
 * investment options, a referral system, deposits/withdrawals and admin commands.
 *
 * Note: This demonstration uses a JSON file for persistent storage (users.json)
 * and in-memory sessions. In production, use a real database.
 */

const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// File to store user data
const USERS_FILE = path.join(__dirname, 'users.json');

// Load users data or create an empty object
let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error('Error reading users file:', e);
        users = {};
    }
}

// Save users to file
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper: get Kenya date/time in a nice format
function getKenyaTime() {
    return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: generate a random alphanumeric string of given length
function randomString(length) {
    let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate a unique referral code: "FY'S-XXXXX"
function generateReferralCode() {
    return "FY'S-" + randomString(5);
}

// Generate a deposit ID: e.g., DEP-XXXXXXXX
function generateDepositID() {
    return "DEP-" + randomString(8);
}

// Generate a withdrawal ID: e.g., WD-XXXX
function generateWithdrawalID() {
    return "WD-" + randomString(4);
}

// In-memory sessions to track conversation state
let sessions = {};

// Super Admin phone (cannot be edited/removed)
const SUPER_ADMIN = '254701339573';
// List of admin phone numbers (initially only super admin)
let admins = [SUPER_ADMIN];

// Create WhatsApp client
const client = new Client();

// Display QR code in terminal for authentication
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp mobile app.');
});

// Log when client is ready
client.on('ready', () => {
    console.log(`Client is ready! [${getKenyaTime()}]`);
});

// Listen to all incoming messages
client.on('message_create', async message => {
    const chatId = message.from;
    const msgBody = message.body.trim();
    console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

    // --- Navigation shortcuts: "0" for back, "00" for main menu ---
    if (msgBody === '00') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🏠 Returning to Main Menu\n${mainMenuText(chatId)}`);
        return;
    }
    // "0" could be used to cancel the current action.
    if (msgBody === '0') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🔙 Going back to Main Menu\n${mainMenuText(chatId)}`);
        return;
    }

    // --- Admin Commands ---
    if (msgBody.startsWith('admin') && isAdmin(chatId)) {
        await processAdminCommand(message);
        return;
    }

    // --- Check if user is registered (by WhatsApp id) ---
    let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
    // If no session exists, initialize it.
    if (!sessions[chatId]) {
        sessions[chatId] = { state: registeredUser ? 'main_menu' : 'start' };
    }

    let session = sessions[chatId];

    // If user is not registered, start registration process
    if (!registeredUser) {
        await handleRegistration(message, session);
    } else {
        // Process user commands based on current session state
        await handleUserSession(message, session, registeredUser);
    }
});

// ---- Registration Process Handler ----
async function handleRegistration(message, session) {
    const chatId = message.from;
    const msgBody = message.body.trim();

    switch (session.state) {
        case 'start':
            // Send welcome message with emojis and ask for first name
            await message.reply(`👋 Hello! Welcome to FY'S INVESTMENT BOT 😊\nPlease enter your *first name*:`);
            session.state = 'awaiting_first_name';
            break;
        case 'awaiting_first_name':
            session.firstName = msgBody;
            // Wait 2 seconds then ask for second name
            setTimeout(async () => {
                await message.reply(`Great, ${session.firstName}! Now, please enter your *second name*:`);
                session.state = 'awaiting_second_name';
            }, 2000);
            break;
        case 'awaiting_second_name':
            session.secondName = msgBody;
            // Ask for referral code (if any)
            await message.reply(`Thanks, ${session.firstName} ${session.secondName}!\nIf you have a referral code, please enter it now. Otherwise type *NONE*.`);
            session.state = 'awaiting_referral_code';
            break;
        case 'awaiting_referral_code':
            session.referralCodeInput = msgBody.toUpperCase();
            // Validate referral code if not NONE
            if (session.referralCodeInput !== 'NONE') {
                // Search for a user with that referral code
                let referrer = Object.values(users).find(u => u.referralCode === session.referralCodeInput);
                if (referrer) {
                    session.referredBy = referrer.whatsAppId;
                    await message.reply(`👍 Referral code accepted!`);
                } else {
                    await message.reply(`⚠️ Referral code not found. Continuing without referral.`);
                }
            }
            // Next, ask for phone number
            await message.reply(`Please enter your *phone number* (should start with 070 or 01 and be exactly 10 digits):`);
            session.state = 'awaiting_phone';
            break;
        case 'awaiting_phone':
            // Validate phone number (must start with 070 or 01 and be 10 digits)
            if (!/^(070|01)\d{7}$/.test(msgBody)) {
                await message.reply(`❌ Invalid phone number format. Please ensure it starts with 070 or 01 and has exactly 10 digits:`);
            } else {
                session.phone = msgBody;
                // Ask for 4-digit PIN for withdrawals
                await message.reply(`Now, please create a *4-digit PIN* for withdrawals (from referral earnings):`);
                session.state = 'awaiting_withdrawal_pin';
            }
            break;
        case 'awaiting_withdrawal_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a 4-digit PIN:`);
            } else {
                session.withdrawalPIN = msgBody;
                // Ask for 4-digit PIN for security (re-entry after inactivity)
                await message.reply(`Almost done! Please create a *4-digit security PIN*:`);
                session.state = 'awaiting_security_pin';
            }
            break;
        case 'awaiting_security_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a 4-digit security PIN:`);
            } else {
                session.securityPIN = msgBody;
                // Registration complete – save user record.
                let newUserId = session.phone; // using phone as key in our users database
                let newUser = {
                    whatsAppId: chatId,
                    firstName: session.firstName,
                    secondName: session.secondName,
                    phone: session.phone,
                    withdrawalPIN: session.withdrawalPIN,
                    securityPIN: session.securityPIN,
                    referralCode: generateReferralCode(),
                    referredBy: session.referredBy || null,
                    referrals: [],
                    accountBalance: 0,
                    referralEarnings: 0,
                    investments: [],
                    deposits: [],
                    withdrawals: [],
                    banned: false
                };
                users[newUserId] = newUser;
                saveUsers();
                await message.reply(`✅ Registration successful, ${newUser.firstName}! Your referral code is *${newUser.referralCode}*.\n[${getKenyaTime()}]`);
                // If referred, notify the referrer when the user makes their first investment.
                sessions[chatId] = { state: 'main_menu' };
                await message.reply(mainMenuText(chatId));
            }
            break;
        default:
            await message.reply(`Something went wrong in registration. Please try again.`);
            session.state = 'start';
            break;
    }
}

// ---- User Session Handler (after registration) ----
async function handleUserSession(message, session, user) {
    const chatId = message.from;
    const msgBody = message.body.trim();

    // If user is banned, do nothing.
    if (user.banned) {
        await message.reply(`🚫 You have been banned from using this service.`);
        return;
    }

    // Switch based on session state
    switch (session.state) {
        // Main menu: show interactive options
        case 'main_menu':
            await message.reply(mainMenuText(chatId));
            session.state = 'awaiting_menu_selection';
            break;
        case 'awaiting_menu_selection':
            // Menu selection options:
            // 1: Invest, 2: Check Balance, 3: Withdraw Earnings, 4: Deposit Funds, 5: Change PIN
            if (msgBody === '1') {
                session.state = 'invest';
                await message.reply(`💰 Enter the *investment amount* (min Ksh 1,000, max Ksh 150,000):`);
            } else if (msgBody === '2') {
                session.state = 'check_balance_menu';
                await message.reply(`🔍 *Check Balance* Options:\n1. Account Balance\n2. Referral Earnings\n3. Investment History\nReply with 1, 2, or 3:`);
            } else if (msgBody === '3') {
                session.state = 'withdraw';
                await message.reply(`💸 Enter the amount to withdraw from your referral earnings (minimum Ksh 1,000):`);
            } else if (msgBody === '4') {
                session.state = 'deposit';
                await message.reply(`💵 Enter the *deposit amount*:`);
            } else if (msgBody === '5') {
                session.state = 'change_pin';
                await message.reply(`🔑 To change your PIN, please enter your current 4-digit PIN:`);
            } else {
                await message.reply(`❓ Invalid selection. Please choose a valid option.\n${mainMenuText(chatId)}`);
            }
            break;
        case 'invest':
            {
                // Validate investment amount
                let amount = parseFloat(msgBody);
                if (isNaN(amount) || amount < 1000 || amount > 150000) {
                    await message.reply(`❌ Invalid amount. Please enter an amount between Ksh 1,000 and Ksh 150,000:`);
                } else if (user.accountBalance < amount) {
                    await message.reply(`⚠️ Insufficient funds in your account. Your current balance is Ksh ${user.accountBalance}. Please deposit funds first.`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                } else {
                    session.investAmount = amount;
                    session.state = 'confirm_investment';
                    await message.reply(`Please enter your 4-digit PIN to confirm the investment of Ksh ${amount}:`);
                }
            }
            break;
        case 'confirm_investment':
            {
                if (msgBody !== user.withdrawalPIN) {
                    await message.reply(`❌ Incorrect PIN. Please try again or type 0 to cancel.`);
                } else {
                    // Deduct amount from account balance
                    user.accountBalance -= session.investAmount;
                    // Create investment record
                    let investment = {
                        amount: session.investAmount,
                        date: getKenyaTime(),
                        expectedReturn: (session.investAmount * 0.10).toFixed(2),
                        status: 'active'
                    };
                    user.investments.push(investment);
                    // Check if this is the first investment and if the user was referred
                    if (user.investments.length === 1 && user.referredBy) {
                        let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
                        if (referrer) {
                            let bonus = session.investAmount * 0.03;
                            referrer.referralEarnings += bonus;
                            // Also record referral info
                            referrer.referrals.push(user.phone);
                            // Notify the referrer (in a real scenario, you would send a message)
                            console.log(`📢 [${getKenyaTime()}] Referral Bonus: ${referrer.firstName} earned Ksh ${bonus} from ${user.firstName}'s investment.`);
                        }
                    }
                    saveUsers();
                    await message.reply(`✅ Investment confirmed!\nAmount: Ksh ${session.investAmount}\nExpected Return (10% after 24hrs): Ksh ${investment.expectedReturn}\n[${getKenyaTime()}]`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                }
            }
            break;
        case 'check_balance_menu':
            {
                if (msgBody === '1') {
                    await message.reply(`💳 Your Account Balance: Ksh ${user.accountBalance}\n[${getKenyaTime()}]`);
                } else if (msgBody === '2') {
                    await message.reply(`🎉 Your Referral Earnings: Ksh ${user.referralEarnings}\n[${getKenyaTime()}]`);
                } else if (msgBody === '3') {
                    if (user.investments.length === 0) {
                        await message.reply(`📄 You have no investments yet.\n[${getKenyaTime()}]`);
                    } else {
                        let history = user.investments.map((inv, idx) => `${idx + 1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`).join('\n');
                        await message.reply(`📊 Investment History:\n${history}\n[${getKenyaTime()}]`);
                    }
                } else {
                    await message.reply(`❓ Invalid selection in Check Balance. Please choose 1, 2, or 3.`);
                }
                session.state = 'main_menu';
                await message.reply(mainMenuText(chatId));
            }
            break;
        case 'withdraw':
            {
                let amount = parseFloat(msgBody);
                if (isNaN(amount) || amount < 1000) {
                    await message.reply(`❌ Invalid amount. Withdrawal must be at least Ksh 1,000:`);
                } else if (user.referralEarnings < amount) {
                    await message.reply(`⚠️ Insufficient referral earnings. Your current referral earnings are Ksh ${user.referralEarnings}.`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                } else {
                    // Deduct immediately and mark withdrawal as pending
                    user.referralEarnings -= amount;
                    let withdrawal = {
                        amount: amount,
                        date: getKenyaTime(),
                        withdrawalID: generateWithdrawalID(),
                        status: 'pending'
                    };
                    user.withdrawals.push(withdrawal);
                    saveUsers();
                    await message.reply(`✅ Withdrawal request received.\nWithdrawal ID: ${withdrawal.withdrawalID}\nAmount: Ksh ${amount}\nStatus: Under review\n[${getKenyaTime()}]`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                }
            }
            break;
        case 'deposit':
            {
                let amount = parseFloat(msgBody);
                if (isNaN(amount) || amount <= 0) {
                    await message.reply(`❌ Invalid deposit amount. Please enter a valid amount:`);
                } else {
                    // Provide payment details and record deposit request
                    let deposit = {
                        amount: amount,
                        date: getKenyaTime(),
                        depositID: generateDepositID(),
                        status: 'under review'
                    };
                    user.deposits.push(deposit);
                    saveUsers();
                    await message.reply(`💵 Please make payment to M-Pesa 0701339573, Name: Camlus Okoth\nYour deposit request has been received.\nDeposit ID: ${deposit.depositID}\nStatus: Under review\n[${getKenyaTime()}]`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                }
            }
            break;
        case 'change_pin':
            {
                // Validate current PIN
                if (msgBody !== user.withdrawalPIN) {
                    await message.reply(`❌ Incorrect current PIN. Please try again:`);
                } else {
                    session.state = 'new_pin';
                    await message.reply(`🔑 Please enter your new 4-digit PIN:`);
                }
            }
            break;
        case 'new_pin':
            {
                if (!/^\d{4}$/.test(msgBody)) {
                    await message.reply(`❌ Invalid PIN. Please enter a valid 4-digit PIN:`);
                } else {
                    user.withdrawalPIN = msgBody;
                    saveUsers();
                    await message.reply(`✅ PIN changed successfully!\n[${getKenyaTime()}]`);
                    session.state = 'main_menu';
                    await message.reply(mainMenuText(chatId));
                }
            }
            break;
        default:
            // Default to main menu if state is unrecognized
            session.state = 'main_menu';
            await message.reply(mainMenuText(chatId));
            break;
    }
}

// Helper: Generate the main menu text with Kenya date/time and emojis
function mainMenuText(chatId) {
    return `🌟 *FY'S INVESTMENT BOT* 🌟\n[${getKenyaTime()}]\nPlease select an option:\n1. Invest 💰\n2. Check Balance 🔍\n3. Withdraw Earnings 💸\n4. Deposit Funds 💵\n5. Change PIN 🔑\nReply with the option number.\n\nType *00* for Main Menu or *0* to go back.`;
}

// Helper: Check if a chatId belongs to an admin
function isAdmin(chatId) {
    // Remove any formatting from the phone id if needed.
    return admins.includes(chatId.replace(/\D/g, ''));
}

// ---- Admin Command Processor ----
async function processAdminCommand(message) {
    const chatId = message.from;
    const msgBody = message.body.trim();
    // Split command into parts (e.g., "admin view users")
    const parts = msgBody.split(' ');
    if (parts[1] === 'view' && parts[2] === 'users') {
        let userList = Object.values(users).map(u => `${u.firstName} ${u.secondName} - Phone: ${u.phone}`).join('\n');
        if (!userList) userList = 'No registered users.';
        await message.reply(`📋 *User List:*\n${userList}\n[${getKenyaTime()}]`);
    } else if (parts[1] === 'view' && parts[2] === 'investments') {
        // List all ongoing investments from all users
        let investmentsList = '';
        for (let key in users) {
            let u = users[key];
            u.investments.forEach((inv, idx) => {
                investmentsList += `${u.firstName} ${u.secondName} - Investment ${idx + 1}: Ksh ${inv.amount}, Status: ${inv.status}\n`;
            });
        }
        if (!investmentsList) investmentsList = 'No investments found.';
        await message.reply(`📊 *All Investments:*\n${investmentsList}\n[${getKenyaTime()}]`);
    } else if (parts[1] === 'approve' && parts[2] === 'withdrawal') {
        // Command format: admin approve withdrawal WD-XXXX
        let withdrawalID = parts[3];
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID === withdrawalID) {
                    wd.status = 'approved';
                    found = true;
                    // In a real bot, notify the user here
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`✅ Withdrawal ${withdrawalID} approved.\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`❌ Withdrawal ID not found.`);
        }
    } else if (parts[1] === 'reject' && parts[2] === 'withdrawal') {
        // Command format: admin reject withdrawal WD-XXXX Reason...
        let withdrawalID = parts[3];
        let reason = parts.slice(4).join(' ');
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID === withdrawalID) {
                    wd.status = `rejected (${reason})`;
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`❌ Withdrawal ${withdrawalID} rejected. Reason: ${reason}\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`Withdrawal ID not found.`);
        }
    } else if (parts[1] === 'ban' && parts[2] === 'user') {
        // Command format: admin ban user <phone> <reason>
        let phone = parts[3];
        let reason = parts.slice(4).join(' ');
        if (users[phone]) {
            // Prevent banning Super Admin
            if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) {
                await message.reply(`🚫 You cannot ban the Super Admin.`);
                return;
            }
            users[phone].banned = true;
            saveUsers();
            await message.reply(`🚫 User with phone ${phone} has been banned. Reason: ${reason}\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`User with phone ${phone} not found.`);
        }
    } else if (parts[1] === 'add' && parts[2] === 'admin') {
        // Only Super Admin can add new admins
        if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
            await message.reply(`🚫 Only the Super Admin can add new admins.`);
            return;
        }
        let newAdminPhone = parts[3].replace(/\D/g, '');
        if (!admins.includes(newAdminPhone)) {
            admins.push(newAdminPhone);
            await message.reply(`✅ ${newAdminPhone} has been added as an admin.`);
        } else {
            await message.reply(`ℹ️ ${newAdminPhone} is already an admin.`);
        }
    } else {
        await message.reply(`❓ Unrecognized admin command.`);
    }
}

// Initialize the client
client.initialize();
