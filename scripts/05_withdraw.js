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
    console.log('\x1b[34m%s\x1b[0m', '║ Withdraw USDT                               ║');
    console.log('\x1b[34m%s\x1b[0m', '╚═════════════════════════════════════════════╝');
    console.log('network: \x1b[34m%s\x1b[0m', network.name);

    const signers = await ethers.getSigners();
    const signer = signers[2];

    console.log('Signer:', signer.address);

    const balance = await ethers.provider.getBalance(signer.address);
    console.log('Balance:', ethers.formatEther(balance), 'ETH');


    const vault = await ethers.getContractAt(FoxerVaultABI, process.env.VAULT_COLEND_USDT, signer);
    const usdt = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS, signer);

    const usdtBalance = (await usdt.balanceOf(signer.address)) * 10n / 10n;
    console.log('USDT Balance:', usdtBalance.toString());

    const vaultBalance = await vault.balanceOf(signer.address);
    console.log('fxUSDT Balance:', vaultBalance.toString());

    console.log('Withdraw USDT');
    //const tx2 = await vault.deposit(usdtBalance, 0n);
    const tx2 = await vault.withdraw(9930140028n, 0n, {
        gasLimit: 2000000
    });
    console.log(tx2.hash);
    await tx2.wait();

    const usdtBalance2 = (await usdt.balanceOf(signer.address)) * 10n / 10n;
    console.log('USDT Balance after:', usdtBalance2.toString());

    const vaultBalance2 = await vault.balanceOf(signer.address);
    console.log('fxUSDT Balance:', vaultBalance2.toString());

    console.log('--------------------------------------');

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
