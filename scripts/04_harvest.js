const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const upgrades = hre.upgrades;
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});
const FoxerVaultABI = require("../artifacts/contracts/FoxerVault.sol/FoxerVault.json").abi;
const ERC20ABI = require("../abis/ERC20.json");

async function main() {
    console.log('\x1b[34m%s\x1b[0m', '╔═════════════════════════════════════════════╗');
    console.log('\x1b[34m%s\x1b[0m', '║ Check Foxer Colend USDT state               ║');
    console.log('\x1b[34m%s\x1b[0m', '╚═════════════════════════════════════════════╝');
    console.log('network: \x1b[34m%s\x1b[0m', network.name);

    const signers = await ethers.getSigners();
    const signer = signers[1];

    console.log('Signer:', signer.address);

    const balance = await ethers.provider.getBalance(signer.address);
    console.log('Balance:', ethers.formatEther(balance), 'ETH');

    const vault = await ethers.getContractAt(FoxerVaultABI, process.env.VAULT_COLEND_USDT, signer);
    const usdt = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS, signer);
    const btc = await ethers.getContractAt(ERC20ABI, process.env.BTC_ADDRESS, signer);

    const usdtBalance = await usdt.balanceOf(signer.address);
    console.log('USDT Balance:', usdtBalance.toString());

    const vaultBalance = await vault.balanceOf(signer.address);
    console.log('fxUSDT Balance:', vaultBalance.toString());

    const vaultTvl = await vault.balance();
    console.log('Vault TVL:', vaultTvl.toString());

    const btcBalance = await btc.balanceOf(signer.address);
    console.log('BTC Balance:', btcBalance.toString());

    const estimatedPendingRewards = await vault.estimatedPendingRewards(signer.address);
    console.log('Estimated Pending Rewards:', estimatedPendingRewards.toString());

    console.log('--------------------------------------');

    console.log('Harvesting...');
    const tx = await vault.harvest(0);
    console.log(tx.hash);
    await tx.wait();

    const btcBalance2 = await btc.balanceOf(signer.address);
    console.log('BTC Balance:', btcBalance2.toString());

    console.log('Done');

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});