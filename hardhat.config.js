require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();

function base64ToBytes(base64) {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0));
}
function bytesToBase64(bytes) {
    const binString = String.fromCodePoint(...bytes);
    return btoa(binString);
}
//console.log(bytesToBase64(new TextEncoder().encode(''))); process.exit();

const sTest = 'test test test test test test test test test test test junk';
const sCore = (new TextDecoder().decode(base64ToBytes(process.env.SEED_PHRASE_CORE)));

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        hardhat: {
            mining: {
                auto: true,
                //interval: 3000,
                mempool: {
                    order: "fifo"
                }
            },
            accounts: {
                mnemonic: sCore,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 10
            },
            forking: {
                url: "https://rpc.ankr.com/core",
                // blockNumber: 15879020
            },
            chainId: 1337,
            chains: {
                // Core
                1116: {
                    hardforkHistory: {
                        byzantium: 0,
                        constantinople: 0,
                        petersburg: 0,
                        istanbul: 0,
                        muirGlacier: 0,
                        berlin: 0,
                        london: 0,
                        arrowGlacier: 0,
                        grayGlacier: 0,
                    },
                }
            }
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            gas: 30000000,
            gasPrice: 1000000000, // 1 Gwei
            accounts: {
                mnemonic: sCore,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 10
            }
        },
        core: {
            url: "https://rpc.ankr.com/core",
            gas: 30000000,
            accounts: {
                mnemonic: sCore,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 10
            }
        }
    }
};

module.exports = config;
