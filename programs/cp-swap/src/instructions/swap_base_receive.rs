use anchor_lang::prelude::*;
use anchor_spl::{token::{Token},token_2022::spl_token_2022::{self, extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions}}, token_interface::{Mint, TokenAccount, TokenInterface,transfer_checked,TransferChecked}};

use crate::{error::ErrorCode, states::*, CurveMath};

#[derive(Accounts)]
pub struct SwapBaseReceive<'info> {

    pub trader: Signer<'info>,

    pub amm_config: Box<Account<'info,AmmConfig>>,

    #[account(
        has_one = amm_config,
        constraint = (send_mint.key() == pool.mint_0 && receive_mint.key() ==  pool.mint_1) || (send_mint.key() == pool.mint_1 && receive_mint.key() ==  pool.mint_0) @ ErrorCode::MismatchAccounts
    )]
    pub pool: Box<Account<'info,Pool>>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = send_mint,
        token::token_program = send_token_program,
    )]
    pub trader_send_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = send_mint,
        associated_token::token_program = send_token_program,
    )]
    pub send_token_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mint::token_program = send_token_program
    )]
    pub send_mint:Box<InterfaceAccount<'info,Mint>>,
    pub send_token_program:Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = receive_mint,
        token::token_program = receive_token_program,
    )]
    pub trader_receive_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = receive_mint,
        associated_token::token_program = receive_token_program,
    )]
    pub receive_token_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mint::token_program = receive_token_program
    )]
    pub receive_mint:Box<InterfaceAccount<'info,Mint>>,
    pub receive_token_program:Interface<'info,TokenInterface>,
}

pub fn handle_swap_base_receive(ctx:Context<SwapBaseReceive>,exact_amount_trader_receive:u64,max_amount_trader_send:u64) -> Result<()> {
    
    let exact_amount_pool_send = if ctx.accounts.receive_token_program.key() == Token::id() {
        exact_amount_trader_receive
    }else {
        let receive_mint_info = ctx.accounts.receive_mint.to_account_info();
        let receive_mint_data = receive_mint_info.try_borrow_data()?;
        let receive_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&receive_mint_data)?;
        if let Ok(transfer_fee_config) = receive_mint_state.get_extension::<TransferFeeConfig>() {
            let epoch = Clock::get()?.epoch;
            let transfer_fee = transfer_fee_config.get_epoch_fee(epoch);
            transfer_fee.calculate_pre_fee_amount(exact_amount_trader_receive).unwrap()
        }else {
            exact_amount_trader_receive
        }
    };

    let amm_config = &ctx.accounts.amm_config;
    let curve_receive_amount = if amm_config.is_fee_side_receive {
        amm_config.calculate_pre_fee_amount(exact_amount_pool_send)
    }else {
        exact_amount_pool_send
    };

    let send_reserve = ctx.accounts.send_mint.supply;
    let receive_reserve = ctx.accounts.receive_mint.supply;
    let k = CurveMath::calculate_k(send_reserve, receive_reserve);
    let curve_input_amount = CurveMath::calculate_curve_input_amount(send_reserve, receive_reserve, receive_reserve.checked_sub(curve_receive_amount).unwrap());

    let exact_amount_pool_receive  = if !amm_config.is_fee_side_receive {
        amm_config.calculate_pre_fee_amount(curve_input_amount)
    }else {
        curve_input_amount
    };

    let exact_amount_trader_send = if ctx.accounts.send_token_program.key() == Token::id() {
        exact_amount_pool_receive
    }else {
        let send_mint_info = ctx.accounts.send_mint.to_account_info();
        let send_mint_data = send_mint_info.try_borrow_data()?;
        let send_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&send_mint_data)?;
        if let Ok(tranfer_fee_config) = send_mint_state.get_extension::<TransferFeeConfig>() {
            let epoch = Clock::get()?.epoch;
            let transfer_fee = tranfer_fee_config.get_epoch_fee(epoch);
            transfer_fee.calculate_pre_fee_amount(exact_amount_pool_receive).unwrap()
        }else {
            exact_amount_pool_receive
        }
    };

    require!(exact_amount_trader_send <= max_amount_trader_send,ErrorCode::ExceedsMaximumLimit);

    let transfer_send_token_ctx = CpiContext::new(ctx.accounts.send_token_program.key(), TransferChecked {
        from: ctx.accounts.trader_send_token.to_account_info(),
        to:ctx.accounts.send_token_vault.to_account_info(),
        mint:ctx.accounts.send_mint.to_account_info(),
        authority:ctx.accounts.trader.to_account_info()
    });

    transfer_checked(transfer_send_token_ctx,exact_amount_trader_send,ctx.accounts.send_mint.decimals)?;

    let pool = &ctx.accounts.pool;
    let pool_seeds: &[&[u8]] = &[Pool::STATIC_SEED,pool.amm_config.as_ref(),pool.mint_0.as_ref(),pool.mint_1.as_ref(),&[pool.bump]];
    let signer_seeds = [&pool_seeds[..]];

    let transfer_receive_token_ctx = CpiContext::new(ctx.accounts.receive_token_program.key(),TransferChecked {
        from:ctx.accounts.receive_token_vault.to_account_info(),
        to:ctx.accounts.trader_receive_token.to_account_info(),
        mint:ctx.accounts.receive_mint.to_account_info(),
        authority:ctx.accounts.pool.to_account_info(),
    }).with_signer(&signer_seeds);

    transfer_checked(transfer_receive_token_ctx, exact_amount_pool_send, ctx.accounts.receive_mint.decimals)?;

    ctx.accounts.send_token_vault.reload()?;
    ctx.accounts.receive_token_vault.reload()?;

    let new_x = ctx.accounts.send_token_vault.amount;
    let new_y = ctx.accounts.receive_token_vault.amount;
    let new_k = CurveMath::calculate_k(new_x, new_y);
    require!(k <= new_k,ErrorCode::ConstantProductInvariantFailed);

    Ok(())
}
