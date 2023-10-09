#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cosmwasm_std::{
    from_binary, Binary, CosmosMsg, Deps, DepsMut, Empty, Env, MessageInfo, Response, StdResult,
};

use cw2::set_contract_version;

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};

// version info for migration info
const CONTRACT_NAME: &str = "crates.io:cw1-whitelist";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    _msg: InstantiateMsg,
) -> StdResult<Response> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::default())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    // Note: implement this function with different type to add support for custom messages
    // and then import the rest of this contract code.
    msg: ExecuteMsg,
) -> Result<Response<Empty>, ContractError> {
    match msg {
        ExecuteMsg::Execute { msg } => execute_msgs(deps, env, info, msg),
    }
}

pub fn execute_msgs(
    _deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: Binary,
) -> Result<Response, ContractError> {
    let msgs: Vec<CosmosMsg> = from_binary(&msg)?;
    let res = Response::new()
        .add_messages(msgs)
        .add_attribute("action", "execute");
    Ok(res)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(_deps: Deps, _env: Env, _msg: QueryMsg) -> StdResult<Binary> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{coins, SubMsg};
    use serde_json::json;

    #[test]
    fn test_object_to_base64_convert() {
        let encoded: String =
            general_purpose::STANDARD_NO_PAD.encode(json!({"foo": "bar"}).to_string().as_bytes());
        assert_eq!("eyJmb28iOiJiYXIifQ", encoded.as_str())
    }

    #[test]
    fn test_execute() {
        let mut deps = mock_dependencies();
        let caller = "caller";
        // instantiate the contract
        let instantiate_msg = InstantiateMsg {};
        let info = mock_info(caller, &coins(1000, "orai".to_string()));
        instantiate(deps.as_mut(), mock_env(), info.clone(), instantiate_msg).unwrap();

        // try execute from binary
        let encoded: String = general_purpose::STANDARD_NO_PAD.encode(
            json!([{"bank": {
                "send": {
                    "to_address": "receiver",
                    "amount": [
                        {
                            "denom": "orai",
                            "amount": "1"
                        }
                    ]
                }
            }},
            {"bank": {
                "send": {
                    "to_address": "receiver2",
                    "amount": [
                        {
                            "denom": "orai",
                            "amount": "2"
                        }
                    ]
                }
            }}])
            .to_string()
            .as_bytes(),
        );
        let encoded_binary = Binary::from_base64(&encoded).unwrap();
        let result = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::Execute {
                msg: encoded_binary,
            },
        )
        .unwrap();
        assert_eq!(result.messages.len(), 2);
        assert_eq!(
            result.messages[0],
            SubMsg::new(CosmosMsg::Bank(cosmwasm_std::BankMsg::Send {
                to_address: "receiver".to_string(),
                amount: coins(1, "orai".to_string())
            }))
        );
        assert_eq!(
            result.messages[1],
            SubMsg::new(CosmosMsg::Bank(cosmwasm_std::BankMsg::Send {
                to_address: "receiver2".to_string(),
                amount: coins(2, "orai".to_string())
            }))
        )
    }

    #[test]
    fn test_execute_counter_contract() {
        let mut deps = mock_dependencies();
        let caller = "caller";
        // instantiate the contract
        let instantiate_msg = InstantiateMsg {};
        let info = mock_info(caller, &coins(1000, "orai".to_string()));
        instantiate(deps.as_mut(), mock_env(), info.clone(), instantiate_msg).unwrap();

        let increment_counter = Binary::from(r#"{"increment": {}}"#.as_bytes());
        let reset_counter = Binary::from(r#"{"reset":{"count":10}}"#.as_bytes());

        // let encoded_message
        let encoded: String = general_purpose::STANDARD_NO_PAD.encode(
            json!([
            {
                "wasm": {
                    "execute": {
                        "contract_addr": "counter_contract",
                        "msg": increment_counter,
                        "funds": []
                    }
                }
            },
            {
                "wasm": {
                    "execute": {
                        "contract_addr": "counter_contract",
                        "msg": reset_counter,
                        "funds": []
                    }
                }
            }])
            .to_string()
            .as_bytes(),
        );
        let encoded_binary = Binary::from_base64(&encoded).unwrap();
        let result = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::Execute {
                msg: encoded_binary,
            },
        )
        .unwrap();

        assert_eq!(result.messages.len(), 2);
        assert_eq!(
            result.messages[0],
            SubMsg::new(CosmosMsg::Wasm(cosmwasm_std::WasmMsg::Execute {
                contract_addr: "counter_contract".to_string(),
                msg: increment_counter,
                funds: [].into() 
            }))
        );
        assert_eq!(
            result.messages[1],
            SubMsg::new(CosmosMsg::Wasm(cosmwasm_std::WasmMsg::Execute {
                contract_addr: "counter_contract".to_string(),
                msg: reset_counter,
                funds: [].into() 
            }))
        )
    }
}
