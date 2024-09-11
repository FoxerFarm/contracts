const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const upgrades = hre.upgrades;
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});


async function main() {
    console.log('\x1b[34m%s\x1b[0m', '╔════════════════════════════════════╗');
    console.log('\x1b[34m%s\x1b[0m', '║ deploy FoxerVault CORE Colend USDC ║');
    console.log('\x1b[34m%s\x1b[0m', '╚════════════════════════════════════╝');
    console.log('network: \x1b[34m%s\x1b[0m', network.name);

    const signers = await ethers.getSigners();
    const owner = signers[0];
    const admin = signers[3];
    const feeRecipient = signers[4];

    let strategy = ethers.Contract;
    let vault = ethers.Contract;

    console.log('Deployer......:', owner.address);
    console.log('Admin.........:', admin.address);
    console.log('FeeRecipient..:', feeRecipient.address);


    // ------------------------------------------------------------------------------------
    // Create Strategy clone
    // ------------------------------------------------------------------------------------
    const strategyFactory = await ethers.getContractAt("FoxerStrategyColend01Factory", process.env.STRATEGY_COLEND_01_FACTORY);
    const tx3 = await strategyFactory.connect(owner).createClone(
        admin.address,
        process.env.USDC_ADDRESS,
        process.env.BTC_ADDRESS,
        feeRecipient.address,
        50n,
        process.env.COLEND_DATA_PROVIDER_ADDRESS,
        process.env.GLYPH_ROUTER_V2_ADDRESS,
        [ process.env.USDC_ADDRESS, process.env.WCORE_ADDRESS, process.env.BTC_ADDRESS ],
        10000n, // 0.01 USDC minumum swap threshold
        {
            signer: owner
        }
    );
    console.log(tx3.hash);
    await tx3.wait();

    // Get latest clone
    const strategyClone = await strategyFactory.latestClone();
    console.log('strategy clone (USDC):', strategyClone);

    strategy = await ethers.getContractAt("FoxerStrategyColend01", strategyClone);

    console.log('------------------------------------------------');


    // ------------------------------------------------------------------------------------
    // Create Vault clone
    // ------------------------------------------------------------------------------------
    const vaultFactory = await ethers.getContractAt("FoxerVaultFactory", process.env.VAULT_FACTORY);
    const tx6 = await vaultFactory.createClone(
        admin.address,
        process.env.BTC_ADDRESS,
        strategy.target,
        "Foxer Colend USDC",
        "fxclUSDC",
        86400n,
        {
            signer: owner
        }
    );
    console.log(tx6.hash);
    await tx6.wait();

    // Get latest clone
    const vaultClone = await vaultFactory.latestClone();
    console.log('vault clone (USDC):', vaultClone);

    vault = await ethers.getContractAt("FoxerVault", vaultClone);

    console.log('strategy.setVault("', vault.target, '")...');
    await strategy.connect(admin).setVault(vault.target, {
        // gasPrice: ethers.parseUnits('1', 'gwei')
    });
    console.log('Ready');

    console.log('--------------------------------------');

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
