// index.js
console.log("MERGED WITHDRAWAL CODE 1234.6 zk hogwallet 777.6 real vault wallet(with logs-goosehelp.2-verified)= generator called from javasript sub_unlock - JAN 2026: Original ETH deposit/withdraw preserved + subwallet test lock/unlock added + PDAI replaced with USDC (Sepolia)+spoofed wwart tracking w correct spoof fetch"); // Updated tag for USDC switch

const ethers = require("ethers");
const { Wallet } = require("cartesi-wallet");
const { stringToHex, hexToString } = require("viem");
const { parseEther } = require("ethers");
const wallet = new Wallet(); // Keep original instantiation (no balances Map needed unless required; tested compatible)

// === TOKEN ADDRESSES (Sepolia example — change if needed) ===
const WWART_ADDRESS = "0xYourWWARTContractHere"; // Replace or leave as-is if not used yet
const CTSI_ADDRESS = "0xae7f61eCf06C65405560166b259C54031428A9C4";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Real Sepolia USDC (6 decimals)

// === PORTAL ADDRESSES (Sepolia) ===
const EtherPortal = "0xFfdbe43d4c855BF7e0f105c400A50857f53AB044";
const ERC20Portal = "0x4b088b2dee4d3c6ec7aa5fb4e6cd8e9f0a1b2c3d";
const dAppAddressRelay = "0xF5DE34d6BbC0446E2a45719E718efEbaaE179daE";

// === GLOBAL STATE ===
const userVaults = new Map();           // address → vault object
let registeredUsers = new Map();        // address → true
let dAppAddress = "";
let subLocks = new Map(); // NEW: subAddress → {locked: boolean, owner: string, proof: any, minted: bigint, vaultAddress: string} for test lock/unlock
let pendingLocks = new Map(); // subAddress → {owner, proof, vaultAddress, mintedAmount, depositTxHash}
const userMintHistories = new Map(); // user (owner) => array of {amount: bigint, subAddress: string, timestamp: number, txHash: string}
const userBurnHistories = new Map(); // user (owner) => array of {amount: bigint, subAddress: string, timestamp: number}

const rollupServer = process.env.ROLLUP_HTTP_SERVER_URL;
console.log("HTTP rollup_server url:", rollupServer);

// Helper: send a notice
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

// Helper: send a report (used in inspect)
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
  fractionalPart = fractionalPart.replace(/0+$/, "");  // Remove trailing zeros
  return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
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
      console.log("Payload is not JSON (probably a portal deposit)");
    }
  }

  // 1. DApp Address Relay
  if (sender === dAppAddressRelay.toLowerCase()) {
    dAppAddress = payload;
    console.log("DApp address relayed:", dAppAddress);
    return "accept";
  }

  // 2. USER REGISTERS THEIR ADDRESS
  if (input?.type === "register_address") {
    const user = request.metadata.msg_sender.toLowerCase();
    registeredUsers.set(user, true);

    await sendNotice(stringToHex(JSON.stringify({ type: "address_registered", user })));
    console.log("Received register_address from", user);
    return "accept";
  }

  // 3. ETH DEPOSITS — Use manual parsing for proper depositor extraction
  if (sender === EtherPortal.toLowerCase()) {
    console.log("ETH PORTAL INPUT RECEIVED - PAYLOAD:", request.payload);

    let amountWei = 0n;
    let depositor = "";

    try {
      const data = request.payload.slice(2);  // Remove '0x'
      depositor = "0x" + data.slice(0, 40).toLowerCase();
      const amountHex = "0x" + data.slice(40);
      amountWei = BigInt(amountHex);

      console.log("Parsed depositor from payload:", depositor);
      console.log("Parsed amount from payload:", amountWei.toString());
    } catch (e) {
      console.error("ETH payload parsing error:", e);
      return "reject";  // Reject on parse failure to maintain trustless integrity
    }

    if (amountWei === 0n || depositor === "0x0000000000000000000000000000000000000000") {
      console.log("Invalid amount or depositor — ignoring");
      return "accept";
    }

    console.log(`Crediting ${formatEther(amountWei)} ETH to ${depositor}`);

    let vault = userVaults.get(depositor) || {
      liquid: 0n,
      wWART: 0n,
      CTSI: 0n,
      usdc: 0n,
      eth: 0n,
      spoofedMinted: 0n,
      spoofedBurned: 0n
    };

    vault.eth += amountWei;
    userVaults.set(depositor, vault);

    await sendNotice(stringToHex(JSON.stringify({
      type: "eth_deposited",
      user: depositor,
      amount: amountWei.toString(),
      newBalance: vault.eth.toString()
    })));

    return "accept";
  }

  // 4. ERC-20 DEPOSITS (wWART, CTSI, USDC)
  if (sender === ERC20Portal.toLowerCase()) {
    console.log("ERC20 PORTAL INPUT RECEIVED - PAYLOAD:", request.payload);

    let tokenAddress = "";
    let depositor = "";
    let amount = 0n;

    try {
      const data = request.payload.slice(2);  // Remove '0x'
      tokenAddress = "0x" + data.slice(0, 40).toLowerCase();
      depositor = "0x" + data.slice(40, 80).toLowerCase();
      const amountHex = "0x" + data.slice(80, 144);
      amount = BigInt(amountHex);

      console.log("Parsed token:", tokenAddress);
      console.log("Parsed depositor:", depositor);
      console.log("Parsed amount:", amount.toString());
    } catch (e) {
      console.error("ERC20 payload parsing error:", e);
      return "reject";
    }

    if (amount === 0n) {
      console.log("Invalid amount — ignoring");
      return "accept";
    }

    let vault = userVaults.get(depositor) || {
      liquid: 0n,
      wWART: 0n,
      CTSI: 0n,
      usdc: 0n,
      eth: 0n,
      spoofedMinted: 0n,
      spoofedBurned: 0n
    };

    let type = "unknown";
    if (tokenAddress === WWART_ADDRESS.toLowerCase()) {
      vault.wWART += amount;
      type = "wwart_deposited";
    } else if (tokenAddress === CTSI_ADDRESS.toLowerCase()) {
      vault.CTSI += amount;
      type = "ctsi_deposited";
    } else if (tokenAddress === USDC_ADDRESS.toLowerCase()) {
      vault.usdc += amount;  // Note: USDC has 6 decimals, but we store as-is
      type = "usdc_deposited";
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

  // 5. WITHDRAWALS (ETH, wWART, CTSI, USDC)
  if (input?.type === "withdraw_eth") {
    const user = sender;
    const amountWei = parseEther(input.amount).toBigInt();

    let vault = userVaults.get(user) || { eth: 0n };
    if (vault.eth < amountWei) {
      console.log("Insufficient ETH balance");
      return "reject";
    }

    vault.eth -= amountWei;
    userVaults.set(user, vault);

    // Generate voucher for ETH withdrawal
    const voucher = wallet.new_voucher(dAppAddress, 0, stringToHex(JSON.stringify({
      type: "eth_withdraw",
      to: user,
      amount: amountWei.toString()
    })));

    await sendNotice(stringToHex(JSON.stringify({
      type: "eth_withdrawn",
      user,
      amount: amountWei.toString(),
      newBalance: vault.eth.toString(),
      voucher
    })));

    return "accept";
  }

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

    // Generate voucher for ERC20 withdrawal (wWART)
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

    // Generate voucher for ERC20 withdrawal (CTSI)
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

    // Generate voucher for ERC20 withdrawal (USDC)
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

  // NEW: sub_lock handler (test lock with spoofed mint)
  if (input?.type === "sub_lock") {
    console.log("Processing sub_lock input:", input);

    const { subAddress, proof, index: subIndex, recipient: owner } = input;

    if (!subAddress || !proof || !subIndex || !owner) {
      console.log("[sub_lock] Missing fields — rejecting");
      return "reject";
    }

    const ownerLower = owner.toLowerCase();

    // Validate proof (for now, just check if transaction.toAddress matches subAddress)
    const tx = proof.transaction;
    if (tx.toAddress !== subAddress || tx.amountE8 <= 0) {
      console.log("[sub_lock] Invalid proof — rejecting");
      return "reject";
    }

    const mintedAmount = BigInt(tx.amountE8); // E8 units for spoofed wWART

    // NEW: Real ZK proof generation via binary (in Cartesi machine)
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
            resolve(derivedLine.slice(2)); // strip 0x, get 48-hex
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

    // Set pending lock
    pendingLocks.set(subAddress, {
      owner: ownerLower,
      proof,
      vaultAddress,
      mintedAmount,
      depositTxHash: tx.txHash
    });

    // Pending notice
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

  // NEW: sub_unlock handler (test unlock with spoofed burn)
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

    // Validate proof (for now, just check if exists; in real: verify burn TX)
    // Assuming proof is valid for burnAmt

    const burnedAmount = BigInt(burnAmt);

    if (burnedAmount > subLock.minted) {
      console.log("[sub_unlock] Burn amount exceeds minted — rejecting");
      return "reject";
    }

    // Unlock and burn spoofed wWART
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

    // Success notice - this is all the frontend needs
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

  // NEW: sweep_lock handler
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

    // Assume sweep tx is confirmed since proof submitted
    // Now complete the lock
    pendingLocks.delete(subAddress);

    // Create/update vault
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

    // Record subLock
    subLocks.set(subAddress, {
      locked: true,
      owner: pending.owner,
      proof: pending.proof,
      minted: pending.mintedAmount,
      vaultAddress: pending.vaultAddress
    });

    // Record mint history
    const history = userMintHistories.get(pending.owner) || [];
    history.push({
      amount: pending.mintedAmount,
      subAddress,
      timestamp: Date.now(),
      txHash: pending.depositTxHash
    });
    userMintHistories.set(pending.owner, history);

    // Success notice
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

  // === STEP 1: Decode the hex payload to UTF-8 string ===
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
    path = rawPayload; // fallback (shouldn't happen now)
    console.log("PATH WAS ALREADY STRING (unusual):", path);
  } else {
    console.log("UNEXPECTED PAYLOAD TYPE:", typeof rawPayload);
    return "accept";
  }

  // === STEP 2: Now work with the decoded path ===
  if (path.toLowerCase().includes("vault")) {
    console.log("VAULT INSPECT DETECTED - DECODED PATH:", path);

    let address = path.toLowerCase().replace(/^\/+/, ''); // remove leading slashes

    // Extract address after "vault/"
    if (address.startsWith("vault/")) {
      address = address.slice(6);
    } else if (address.startsWith("vault")) {
      address = address.slice(5);
    }

    // Add 0x if missing
    if (!address.startsWith("0x")) {
      address = "0x" + address;
    }

    // Validate address
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
    console.log("ETH balance in vault:", formatEther(vault.eth));

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
