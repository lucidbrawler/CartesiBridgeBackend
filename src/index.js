console.log("MERGED WITHDRAWAL CODE bigInit 1234.6 zk hogwallet 777.6 real vault wallet(with logs-goosehelp.2-verified)= generator called from javasript sub_unlock - JAN 2026: Original ETH deposit/withdraw preserved + subwallet test lock/unlock added + PDAI replaced with USDC (Sepolia)+spoofed wwart tracking w correct spoof fetch - ETH MODULE REFACTORED");

const ethers = require("ethers");
const { Wallet } = require("cartesi-wallet");
const { stringToHex, hexToString } = require("viem");
const wallet = new Wallet();

// === TOKEN ADDRESSES (Sepolia example — change if needed) ===
const WWART_ADDRESS = "0xYourWWARTContractHere";
const CTSI_ADDRESS = "0xae7f61eCf06C65405560166b259C54031428A9C4";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Real Sepolia USDC (6 decimals)

// === PORTAL ADDRESSES (Sepolia) ===
const EtherPortal = "0xFfdbe43d4c855BF7e0f105c400A50857f53AB044".toLowerCase();
const ERC20Portal = "0x4b088b2dee4d3c6ec7aa5fb4e6cd8e9f0a1b2c3d".toLowerCase();
const dAppAddressRelay = "0xF5DE34d6BbC0446E2a45719E718efEbaaE179daE".toLowerCase();

// === GLOBAL STATE ===
const userVaults = new Map();
let registeredUsers = new Map();
let dAppAddress = "";
let subLocks = new Map();
let pendingLocks = new Map();
const userMintHistories = new Map();
const userBurnHistories = new Map();

const rollupServer = process.env.ROLLUP_HTTP_SERVER_URL;
console.log("HTTP rollup_server url:", rollupServer);

// Helpers
const sendNotice = async (payload) => {
  try {
    await fetch(`${rollupServer}/notice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
  } catch (e) {
    console.error("Notice failed:", e);
  }
};

const sendReport = async (payload) => {
  try {
    await fetch(`${rollupServer}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
  } catch (e) {
    console.error("Report failed:", e);
  }
};

const formatEther = (wei) => {
  if (wei === 0n) return "0.0";
  const str = wei.toString();
  const integerPart = str.length > 18 ? str.slice(0, str.length - 18) : "0";
  let fractionalPart = str.length > 18 ? str.slice(str.length - 18) : "0".repeat(18 - str.length) + str;
  fractionalPart = fractionalPart.replace(/0+$/, "");
  return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
};

// =============================================================================
// ETH MODULE ──────────────────────────────────────────────────────────────────
// All ETH deposit / withdraw logic lives here
// =============================================================================

const ETH = {
  PORTAL_ADDRESS: EtherPortal,

  WITHDRAW_SELECTOR: "0x522f6815",          // withdrawEther(address to, uint256 amount)

  // ─── Deposit handling ─────────────────────────────────────────────────────
  parseDepositPayload(payload) {
    if (typeof payload !== 'string' || !payload.startsWith('0x') || payload.length !== 106) {
      console.log("ETH deposit payload has unexpected length/format");
      return null;
    }

    try {
      const data = payload.slice(2);
      const depositor = "0x" + data.slice(0, 40).toLowerCase();
      const amountHex = "0x" + data.slice(40);
      const amountWei = BigInt(amountHex);

      if (amountWei <= 0n || depositor === "0x0000000000000000000000000000000000000000") {
        return null;
      }

      return { depositor, amountWei };
    } catch (err) {
      console.error("ETH deposit payload parsing error:", err);
      return null;
    }
  },

  creditToVault(vaults, depositor, amountWei) {
    let vault = vaults.get(depositor) || {
      liquid: 0n,
      wWART: 0n,
      CTSI: 0n,
      usdc: 0n,
      eth: 0n,
      spoofedMinted: 0n,
      spoofedBurned: 0n
    };
    vault.eth += amountWei;
    vaults.set(depositor, vault);
  },

  createDepositNotice(depositor, amountWei) {
    const vault = userVaults.get(depositor);
    return {
      type: "eth_deposited",
      user: depositor,
      amount: amountWei.toString(),
      newBalance: vault?.eth.toString() ?? "0"
    };
  },

  // ─── Withdrawal handling ──────────────────────────────────────────────────
  buildWithdrawPayload(recipient, amountWei) {
    const recipientNo0x = recipient.slice(2).padStart(64, '0');
    const amountNo0x    = amountWei.toString(16).padStart(64, '0');

    return "0x" + ETH.WITHDRAW_SELECTOR.slice(2) + recipientNo0x + amountNo0x;
  },

  async emitVoucher(destination, payload) {
    const voucher = { destination, payload };
    const res = await fetch(`${rollupServer}/voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voucher),
    });

    if (!res.ok) {
      throw new Error(`Voucher emission failed: HTTP ${res.status}`);
    }
  },

  createWithdrawNotice(user, amountWei) {
    return {
      type: "eth_withdrawn",
      user,
      amount: formatEther(amountWei)
    };
  }
};

// === ADVANCE STATE HANDLER ===
const handleAdvance = async (request) => {
  const payload = request.payload;
  const sender = request.metadata.msg_sender.toLowerCase();

  let input = null;
  if (payload && payload.startsWith("0x")) {
    try {
      const decoded = hexToString(payload);
      input = JSON.parse(decoded);
      console.log("Parsed input:", input);
    } catch (e) {
      console.log("Payload is not JSON (probably portal deposit)");
    }
  }

  // 1. DApp Address Relay
  if (sender === dAppAddressRelay) {
    dAppAddress = payload;
    console.log("DApp address relayed:", dAppAddress);
    return "accept";
  }

  // 2. USER REGISTERS THEIR ADDRESS
  if (input?.type === "register_address") {
    const user = sender;
    registeredUsers.set(user, true);

    await sendNotice(stringToHex(JSON.stringify({ type: "address_registered", user })));
    console.log("Received register_address from", user);
    return "accept";
  }

  // 3. ETH DEPOSITS ─ using ETH module
  if (sender === ETH.PORTAL_ADDRESS) {
    console.log("ETH PORTAL INPUT RECEIVED - PAYLOAD:", request.payload);

    const parsed = ETH.parseDepositPayload(request.payload);
    if (!parsed) {
      console.log("Invalid amount or depositor — ignoring");
      return "accept";
    }

    const { depositor, amountWei } = parsed;

    console.log(`Crediting ${formatEther(amountWei)} ETH to ${depositor}`);

    ETH.creditToVault(userVaults, depositor, amountWei);

    const noticePayload = ETH.createDepositNotice(depositor, amountWei);
    await sendNotice(stringToHex(JSON.stringify(noticePayload)));

    console.log(`*** ETH DEPOSIT CREDITED: ${formatEther(amountWei)} ETH → ${depositor} ***`);

    return "accept";
  }

  // 4. ERC-20 DEPOSITS (wWART, CTSI, USDC) ─ unchanged
  if (sender === ERC20Portal) {
    console.log("ERC20 PORTAL INPUT RECEIVED - PAYLOAD:", request.payload);

    let tokenAddress = "", depositor = "", amount = 0n;

    try {
      const data = request.payload.slice(2);
      tokenAddress = "0x" + data.slice(0, 40).toLowerCase();
      depositor    = "0x" + data.slice(40, 80).toLowerCase();
      const amountHex = "0x" + data.slice(80, 144);
      amount = BigInt(amountHex);

      console.log("Parsed token:", tokenAddress);
      console.log("Parsed depositor:", depositor);
      console.log("Parsed amount:", amount.toString());
    } catch (e) {
      console.error("ERC20 payload parsing error:", e);
      return "reject";
    }

    if (amount === 0n) return "accept";

    let vault = userVaults.get(depositor) || {
      liquid: 0n, wWART: 0n, CTSI: 0n, usdc: 0n, eth: 0n,
      spoofedMinted: 0n, spoofedBurned: 0n
    };

    let type = "unknown";
    if (tokenAddress === WWART_ADDRESS.toLowerCase()) {
      vault.wWART += amount; type = "wwart_deposited";
    } else if (tokenAddress === CTSI_ADDRESS.toLowerCase()) {
      vault.CTSI += amount; type = "ctsi_deposited";
    } else if (tokenAddress === USDC_ADDRESS.toLowerCase()) {
      vault.usdc += amount; type = "usdc_deposited";
    } else {
      console.log("Unknown token — ignoring");
      return "accept";
    }

    userVaults.set(depositor, vault);

    await sendNotice(stringToHex(JSON.stringify({
      type,
      user: depositor,
      amount: amount.toString(),
      newBalance: type === "wwart_deposited" ? vault.wWART.toString() :
                  type === "ctsi_deposited" ? vault.CTSI.toString() :
                  vault.usdc.toString()
    })));

    return "accept";
  }

  // 5. ETH WITHDRAWAL ─ using ETH module + manual amount parsing
  if (input?.type === "withdraw_eth" && input.amount) {
    const user = sender;

    if (!dAppAddress) {
      console.log("dApp address not relayed yet, cannot withdraw");
      return "reject";
    }

    let amountWei;
    try {
      const parts = input.amount.split('.');
      if (parts.length > 2) throw new Error("Invalid amount format");

      let integerPart   = BigInt(parts[0] || "0");
      let fractionalPart = parts[1]
        ? BigInt(parts[1].padEnd(18, '0').slice(0, 18))
        : 0n;

      amountWei = integerPart * 1000000000000000000n + fractionalPart;

      if (amountWei <= 0n) throw new Error("Amount must be positive");
    } catch (e) {
      console.error("Invalid ETH amount format:", e.message);
      return "reject";
    }

    let vault = userVaults.get(user);
    if (!vault || vault.eth < amountWei) {
      console.log("Insufficient ETH balance for withdrawal");
      return "reject";
    }

    console.log(`Processing withdrawal of ${formatEther(amountWei)} ETH for ${user}`);

    vault.eth -= amountWei;
    userVaults.set(user, vault);

    try {
      const payload = ETH.buildWithdrawPayload(user, amountWei);
      await ETH.emitVoucher(dAppAddress, payload);

      const notice = ETH.createWithdrawNotice(user, amountWei);
      await sendNotice(stringToHex(JSON.stringify(notice)));

      console.log(`*** ETH WITHDRAWAL PROCESSED: ${formatEther(amountWei)} ETH → ${user} ***`);
      return "accept";
    } catch (e) {
      vault.eth += amountWei;
      userVaults.set(user, vault);
      console.error("Voucher emission failed:", e.message);
      return "reject";
    }
  }

  // ERC-20 WITHDRAWALS ─ unchanged
  if (input?.type === "withdraw_wwart") {
    const user = sender;
    const amount = BigInt(input.amount);

    let vault = userVaults.get(user) || { wWART: 0n };
    if (vault.wWART < amount) {
      console.log("Insufficient wWART balance");
      return "reject";
    }

    vault.wWART -= amount;
    userVaults.set(user, vault);

    const voucher = wallet.new_voucher(dAppAddress, 0, stringToHex(JSON.stringify({
      type: "erc20_withdraw",
      token: WWART_ADDRESS,
      to: user,
      amount: amount.toString()
    })));

    await sendNotice(stringToHex(JSON.stringify({
      type: "wwart_withdrawn",
      user,
      amount: amount.toString(),
      newBalance: vault.wWART.toString(),
      voucher
    })));

    return "accept";
  }

  if (input?.type === "withdraw_ctsi") {
    const user = sender;
    const amount = BigInt(input.amount);

    let vault = userVaults.get(user) || { CTSI: 0n };
    if (vault.CTSI < amount) {
      console.log("Insufficient CTSI balance");
      return "reject";
    }

    vault.CTSI -= amount;
    userVaults.set(user, vault);

    const voucher = wallet.new_voucher(dAppAddress, 0, stringToHex(JSON.stringify({
      type: "erc20_withdraw",
      token: CTSI_ADDRESS,
      to: user,
      amount: amount.toString()
    })));

    await sendNotice(stringToHex(JSON.stringify({
      type: "ctsi_withdrawn",
      user,
      amount: amount.toString(),
      newBalance: vault.CTSI.toString(),
      voucher
    })));

    return "accept";
  }

  if (input?.type === "withdraw_usdc") {
    const user = sender;
    const amount = BigInt(input.amount);

    let vault = userVaults.get(user) || { usdc: 0n };
    if (vault.usdc < amount) {
      console.log("Insufficient USDC balance");
      return "reject";
    }

    vault.usdc -= amount;
    userVaults.set(user, vault);

    const voucher = wallet.new_voucher(dAppAddress, 0, stringToHex(JSON.stringify({
      type: "erc20_withdraw",
      token: USDC_ADDRESS,
      to: user,
      amount: amount.toString()
    })));

    await sendNotice(stringToHex(JSON.stringify({
      type: "usdc_withdrawn",
      user,
      amount: amount.toString(),
      newBalance: vault.usdc.toString(),
      voucher
    })));

    return "accept";
  }

  // SUBWALLET / LOCK / UNLOCK LOGIC ─ unchanged
  if (input?.type === "sub_lock") {
    console.log("Processing sub_lock input:", input);

    const { subAddress, proof, index: subIndex, recipient: owner } = input;

    if (!subAddress || !proof || !subIndex || !owner) {
      console.log("[sub_lock] Missing fields — rejecting");
      return "reject";
    }

    const ownerLower = owner.toLowerCase();

    const tx = proof.transaction;
    if (tx.toAddress !== subAddress || tx.amountE8 <= 0) {
      console.log("[sub_lock] Invalid proof — rejecting");
      return "reject";
    }

    const mintedAmount = BigInt(tx.amountE8);

    const { exec } = require('child_process');
    let vaultAddress;
    try {
      vaultAddress = await new Promise((resolve, reject) => {
        const cmd = `/opt/cartesi/bin/zk-proof-generator --sub-address ${subAddress} --index ${subIndex}`;
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            console.error("ZK binary failed:", stderr);
            return reject(error);
          }
          const outputLines = stdout.trim().split('\n');
          const derivedLine = outputLines.find(line => line.startsWith('0x'));
          if (derivedLine) {
            resolve(derivedLine.slice(2));
          } else {
            reject(new Error('No valid ZK output'));
          }
        });
      });
      console.log(`ZK Proof: Real vault address derived: ${vaultAddress}`);
    } catch (e) {
      console.error("[sub_lock] ZK derivation failed:", e);
      return "reject";
    }

    pendingLocks.set(subAddress, {
      owner: ownerLower,
      proof,
      vaultAddress,
      mintedAmount,
      depositTxHash: tx.txHash
    });

    await sendNotice(stringToHex(JSON.stringify({
      type: "subwallet_pending",
      subAddress,
      vaultAddress,
      mintedE8: mintedAmount.toString(),
      timestamp: Date.now(),
      message: "Sub-wallet deposit initiated - waiting for sweep to vault"
    })));

    console.log(`[sub_lock] PENDING: ${subAddress} initiated for ${ownerLower}, vault ${vaultAddress}`);

    return "accept";
  }

  if (input?.type === "sub_unlock") {
    console.log("Processing sub_unlock input:", input);

    const { subAddress, proof, burnAmt } = input;

    if (!subAddress || !proof || !burnAmt) {
      console.log("[sub_unlock] Missing fields — rejecting");
      return "reject";
    }

    const subLock = subLocks.get(subAddress);
    if (!subLock || !subLock.locked) {
      console.log("[sub_unlock] Subwallet not locked — rejecting");
      return "reject";
    }

    const burnedAmount = BigInt(burnAmt);

    if (burnedAmount > subLock.minted) {
      console.log("[sub_unlock] Burn amount exceeds minted — rejecting");
      return "reject";
    }

    subLock.locked = false;
    subLocks.set(subAddress, subLock);

    const vaultAddress = subLock.vaultAddress;
    let vault = userVaults.get(vaultAddress);
    if (vault) {
      vault.spoofedBurned += burnedAmount;
      userVaults.set(vaultAddress, vault);
    }

    const history = userBurnHistories.get(vaultAddress) || [];
    history.push({
      amount: burnedAmount,
      subAddress,
      timestamp: Date.now()
    });
    userBurnHistories.set(vaultAddress, history);

    await sendNotice(stringToHex(JSON.stringify({
      type: "subwallet_unlocked",
      subAddress,
      verified: true,
      burnedE8: burnedAmount.toString(),
      timestamp: Date.now(),
      message: "Sub-wallet unlocked - you can now withdraw using your private key"
    })));

    console.log(`[sub_unlock] SUCCESS: ${subAddress} unlocked (${burnedAmount} tracked)`);

    return "accept";
  }

  if (input?.type === "sweep_lock") {
    console.log("Processing sweep_lock input:", input);

    const { subAddress, sweepProof } = input;

    if (!subAddress || !sweepProof || !sweepProof.transaction) {
      console.log("[sweep_lock] Missing fields — rejecting");
      return "reject";
    }

    const pending = pendingLocks.get(subAddress);
    if (!pending) {
      console.log("[sweep_lock] No pending lock for subAddress — rejecting");
      return "reject";
    }

    const sweepTx = sweepProof.transaction;
    if (sweepTx.fromAddress !== subAddress || sweepTx.toAddress !== pending.vaultAddress) {
      console.log("[sweep_lock] Invalid sweep tx — rejecting");
      return "reject";
    }

    pendingLocks.delete(subAddress);

    let vault = userVaults.get(pending.vaultAddress) || {
      liquid: 0n,
      wWART: 0n,
      CTSI: 0n,
      usdc: 0n,
      eth: 0n,
      spoofedMinted: 0n,
      spoofedBurned: 0n
    };

    vault.spoofedMinted += pending.mintedAmount;
    vault.wWART += pending.mintedAmount;
    userVaults.set(pending.vaultAddress, vault);

    subLocks.set(subAddress, {
      locked: true,
      owner: pending.owner,
      proof: pending.proof,
      minted: pending.mintedAmount,
      vaultAddress: pending.vaultAddress
    });

    const history = userMintHistories.get(pending.owner) || [];
    history.push({
      amount: pending.mintedAmount,
      subAddress,
      timestamp: Date.now(),
      txHash: pending.depositTxHash
    });
    userMintHistories.set(pending.owner, history);

    await sendNotice(stringToHex(JSON.stringify({
      type: "sweep_locked",
      subAddress,
      locked: true,
      vaultAddress: pending.vaultAddress,
      mintedE8: pending.mintedAmount.toString(),
      timestamp: Date.now(),
      verified: true,
      message: "Sub-wallet locked - sweep confirmed, deposit received in vault"
    })));

    console.log(`[sweep_lock] SUCCESS: ${subAddress} locked for ${pending.owner} with ${pending.mintedAmount} spoofed wWART`);

    return "accept";
  }

  return "accept";
};

// === INSPECT HANDLER ===
const handleInspect = async (rawPayload) => {
  console.log("INSPECT REQUEST - RAW PAYLOAD:", rawPayload || "NO PAYLOAD");

  let path = "";
  if (typeof rawPayload === "string" && rawPayload.startsWith("0x")) {
    try {
      path = Buffer.from(rawPayload.slice(2), "hex").toString("utf-8");
      console.log("SUCCESSFULLY DECODED PATH:", path);
    } catch (e) {
      console.log("FAILED TO DECODE HEX PAYLOAD:", e.message);
      return "accept";
    }
  } else if (typeof rawPayload === "string") {
    path = rawPayload;
    console.log("PATH WAS ALREADY STRING (unusual):", path);
  } else {
    console.log("UNEXPECTED PAYLOAD TYPE:", typeof rawPayload);
    return "accept";
  }

  if (path.toLowerCase().includes("vault")) {
    console.log("VAULT INSPECT DETECTED - DECODED PATH:", path);

    let address = path.toLowerCase().replace(/^\/+/, '');

    if (address.startsWith("vault/")) {
      address = address.slice(6);
    } else if (address.startsWith("vault")) {
      address = address.slice(5);
    }

    if (!address.startsWith("0x")) {
      address = "0x" + address;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      console.log("INVALID ADDRESS EXTRACTED:", address);
      await sendReport(stringToHex(JSON.stringify({ error: "Invalid Ethereum address" })));
      return "accept";
    }

    console.log("QUERYING VAULT FOR ADDRESS:", address);

    const vault = userVaults.get(address) || {
      liquid: 0n,
      wWART: 0n,
      CTSI: 0n,
      usdc: 0n,
      eth: 0n,
      spoofedMinted: 0n,
      spoofedBurned: 0n
    };

    const mintHistory = userMintHistories.get(address) || [];
    const burnHistory = userBurnHistories.get(address) || [];
    const totalSpoofedMintedE8 = mintHistory.reduce((sum, m) => sum + m.amount, 0n);
    const totalSpoofedBurnedE8 = burnHistory.reduce((sum, b) => sum + b.amount, 0n);

    const reportPayload = stringToHex(JSON.stringify({
      liquid: vault.liquid.toString(),
      wWART: vault.wWART.toString(),
      CTSI: vault.CTSI.toString(),
      usdc: vault.usdc.toString(),
      eth: formatEther(vault.eth),
      spoofedMintHistory: mintHistory.map(m => ({...m, amount: m.amount.toString()})),
      spoofedBurnHistory: burnHistory.map(b => ({...b, amount: b.amount.toString()})),
      totalSpoofedMinted: totalSpoofedMintedE8.toString(),
      totalSpoofedBurned: totalSpoofedBurnedE8.toString()
    }));
    await sendReport(reportPayload);
    console.log("VAULT REPORT SENT FOR:", address);
  } else {
    console.log("Non-vault inspect path - ignored:", path);
  }

  return "accept";
};

// === MAIN LOOP ===
async function main() {
  let status = "accept";

  while (true) {
    const finishRes = await fetch(`${rollupServer}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (finishRes.status === 200) {
      const data = await finishRes.json();

      if (data.request_type === "advance_state") {
        status = await handleAdvance(data.data);
      } else if (data.request_type === "inspect_state") {
        let inspectPath = null;

        if (data.data && typeof data.data === "object") {
          if (data.data.path !== undefined) {
            inspectPath = data.data.path;
          } else if (data.data.payload !== undefined) {
            inspectPath = data.data.payload;
          } else {
            inspectPath = JSON.stringify(data.data);
          }
        } else if (data.data) {
          inspectPath = data.data;
        }

        console.log("INSPECT REQUEST - Extracted path:", inspectPath);
        status = await handleInspect(inspectPath);
      }
    } else {
      console.error("Finish error:", finishRes.status);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch((err) => {
  console.error("DApp crashed:", err);
  process.exit(1);
});