use anchor_lang::prelude::*;
// use crate::constants::{SWAP_FEES_DENOMINATION};
#[account]
#[derive(InitSpace)]
pub struct Pool{
    pub creator:Pubkey,
    pub mint_0:Pubkey,
    pub mint_1:Pubkey,
    pub amm_config:Pubkey,
    pub lp_supply:u64,
    pub bump:u8,
    pub lp_mint_bump:u8,
}

impl Pool {
    pub const LEN:usize = 8 + Pool::INIT_SPACE;
    pub const STATIC_SEED:&[u8] = b"pool";

//     pub fn swap_fees(&self,net_input_amount:u64)-> u64 {
//         let dividend = u128::from(net_input_amount).checked_mul(self.fees_in_ppm.into()).unwrap().checked_div(SWAP_FEES_DENOMINATION.into()).unwrap();
//         let remainder = u128::from(net_input_amount).checked_mul(self.fees_in_ppm.into()).unwrap().checked_rem(SWAP_FEES_DENOMINATION.into()).unwrap();

//         let mut swap_fees = dividend;
//         if remainder > 0 {
//             swap_fees+=1;
//         }
//         u64::try_from(swap_fees).unwrap()
//     }
}