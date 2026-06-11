use anchor_lang::prelude::*;

use anchor_spl::{associated_token::AssociatedToken, token::{Token, TransferChecked} ,token_interface::{Mint, MintToChecked, TokenAccount, TokenInterface, mint_to_checked,transfer_checked_with_fee,TransferCheckedWithFee}};
use crate::*;
use crate::error::ErrorCode;
#[derive(Accounts)]
#[instruction(fees_in_ppm:u32)]
pub struct Deposit<'info>{
    
    #[account(mut)]
    pub lp: Signer<'info>,
// 
    // #[account(
    //     // seeds = [POOL_AUTHORITY.as_bytes(),mint_a.key().as_ref(),min]
    // )]
    pub authority:SystemAccount<'info>,

    #[account(
        mut,
        mint::authority = authority,
        mint::token_program = token_program
    )]
    pub lp_mint:InterfaceAccount<'info,Mint>,

    #[account(
        init_if_needed,
        payer = lp,
        associated_token::mint = lp_mint,
        associated_token::authority = lp,
        associated_token::token_program = token_program
    )]
    pub lp_token:InterfaceAccount<'info,TokenAccount>,

    pub mint_a:InterfaceAccount<'info,Mint>,

    #[account(
        mut,
        token::mint = mint_a,
        token::authority = lp,
        token::token_program = token_a_program
    )]
    pub lp_token_a: InterfaceAccount<'info,TokenAccount>,

        #[account(
        mut,
        token::mint = mint_b,
        token::authority = lp,
        token::token_program = token_b_program
    )]
    pub lp_token_b: InterfaceAccount<'info,TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = authority,
        associated_token::token_program = token_a_program
    )]
    pub token_a_vault:InterfaceAccount<'info,TokenAccount>,

        #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = authority,
        associated_token::token_program = token_b_program
    )]
    pub token_b_vault:InterfaceAccount<'info,TokenAccount>,
    pub mint_b:InterfaceAccount<'info,Mint>,

    
    // #[account(
    //     has_one = mint_a,
    //     has_one = mint_b,
    // )]
    // pub pool_state:Account<'info,Pool>
    pub system_program:Program<'info,System>,
    pub token_a_program : Interface<'info,TokenInterface>,
    pub token_b_program : Interface<'info,TokenInterface>,

    pub associated_token_program:Program<'info,AssociatedToken>,

    pub token_program:Program<'info,Token>

}

pub fn deposit_handler(ctx:Context<Deposit>,fees_in_ppm:u32,lp_tokens_required:u64, max_deposit_a:u64,max_deposit_b:u64)->Result<()>{
    // Provided the number of lp tokens required by the lp, we must calculate the tokens of mint a and mint b to be deposited to the pool to be able to mint lp_mint_required amount of tokens.
    // LP tokens = deposit / reserve * lp supply.
    // (lp tokens * reserve_a ) / lp supply  is the net deposit post tax charged by the mint if mint is owned by token 2022 and has TransferFeeConfig extension enabled.
    let (net_deposit_a,net_deposit_b) = (calculate_deposit(lp_tokens_required, ctx.accounts.lp_mint.supply + LOCKED_LP, ctx.accounts.token_a_vault.amount)?,calculate_deposit(lp_tokens_required, ctx.accounts.lp_mint.supply + LOCKED_LP, ctx.accounts.token_b_vault.amount)?);
    
    // we have to calculate the inverse transfer fees for the above result and the resultant is less than or equal to the max deposit of each token.
    let (transfer_fee_a,transfer_fee_b) = (get_inverse_transfer_fee(&ctx.accounts.mint_a, net_deposit_a)?,get_inverse_transfer_fee(&ctx.accounts.mint_b, net_deposit_b)?);

    // Then transfer the tokens from lp_token accounts to pool reserves and mint the required lp_mint_required tokens to the lp token account.
    let (gross_deposit_a,gross_deposit_b) = (net_deposit_a.checked_add(transfer_fee_a).unwrap()
    ,net_deposit_b.checked_add(transfer_fee_b).unwrap()); 

    require_gte!(max_deposit_a,gross_deposit_a,ErrorCode::InsufficientFunds);
    require_gte!(max_deposit_b,gross_deposit_b,ErrorCode::InsufficientFunds);

    let mint_a_pubkey = ctx.accounts.mint_a.key();
    let mint_b_pubkey = ctx.accounts.mint_b.key();
    let fees_in_ppm_bytes = fees_in_ppm.to_le_bytes();

    let pool_authority_seeds : &[&[u8]] = &[POOL_AUTHORITY.as_bytes(),mint_a_pubkey.as_ref(),mint_b_pubkey.as_ref(),fees_in_ppm_bytes.as_ref()];
    let signer_seeds = &[&pool_authority_seeds[..]];

    let mint_to_ctx = CpiContext::new(ctx.accounts.token_program.key(), MintToChecked{
        mint:ctx.accounts.lp_mint.to_account_info(),
        to:ctx.accounts.lp_token.to_account_info(),
        authority:ctx.accounts.authority.to_account_info()
    }).with_signer(signer_seeds);

    mint_to_checked(mint_to_ctx, lp_tokens_required, ctx.accounts.lp_mint.decimals)?;

    let transfer_token_a_ctx = CpiContext::new(ctx.accounts.token_a_program.key(),TransferCheckedWithFee {
        token_program_id:ctx.accounts.token_a_program.to_account_info(),
        source:ctx.accounts.lp_token_a.to_account_info(),
        destination:ctx.accounts.token_a_vault.to_account_info(),
        authority:ctx.accounts.lp.to_account_info(),
        mint:ctx.accounts.mint_a.to_account_info()
    });

    transfer_checked_with_fee(transfer_token_a_ctx, gross_deposit_a, ctx.accounts.mint_a.decimals, transfer_fee_a)?;

    let transfer_token_b_ctx = CpiContext::new(ctx.accounts.token_b_program.key(),TransferCheckedWithFee {
        token_program_id:ctx.accounts.token_b_program.to_account_info(),
        source:ctx.accounts.lp_token_b.to_account_info(),
        destination:ctx.accounts.token_b_vault.to_account_info(),
        authority:ctx.accounts.lp.to_account_info(),
        mint:ctx.accounts.mint_b.to_account_info()
    });
    
    transfer_checked_with_fee(transfer_token_b_ctx, gross_deposit_b, ctx.accounts.mint_b.decimals, transfer_fee_b)?;

    Ok(())
}

pub fn calculate_deposit(lp_tokens_required:u64,lp_supply:u64,reserve:u64)->Result<u64>{
    let divident = u128::from(lp_tokens_required).checked_mul(reserve.into()).unwrap().checked_div(lp_supply.into()).unwrap();
    let reminder = u128::from(lp_tokens_required).checked_mul(reserve.into()).unwrap().checked_rem(lp_supply.into()).unwrap();

    let mut deposit = divident;
    if reminder > 0 {
        deposit +=1;
    }
     return Ok(u64::try_from(deposit).unwrap());
}