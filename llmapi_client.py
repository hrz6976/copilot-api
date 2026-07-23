import json
import requests
import argparse
from msal import PublicClientApplication
 
class LLMClient:
 
    _ENDPOINT = 'https://fe-26.qas.bing.net/sdf/'
    _SCOPES = ['https://substrate.office.com/llmapi/LLMAPI.dev']
    _API_COMPLETIONS = 'completions'
    _API_CHAT_COMPLETIONS = 'chat/completions'
 
    def __init__(self, endpoint):
        if endpoint != None:
            LLMClient._ENDPOINT = endpoint        
 
        self._app = PublicClientApplication('68df66a4-cad9-4bfd-872b-c6ddde00d6b2',
                                            authority='https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47',
                                            enable_broker_on_windows=True, enable_broker_on_mac=True)
 
    def send_request(self, model_name, request, chat_completion = False, api_version = None):
        # get the token
        token = self._get_token()
 
        # populate the headers
        headers = {
            'Content-Type':'application/json',
            'Authorization': 'Bearer ' + token,
            'X-ModelType': model_name,
            "X-Taxonomy-Experience": "AppCopilots",
            "X-Taxonomy-Agent": "LLMAPISampleApp",
            "X-Taxonomy-InferenceStep": "InferenceTest",
            "X-Taxonomy-TrafficType": "Test",
        }
 
        body = str.encode(json.dumps(request))
        _endpoint = LLMClient._ENDPOINT + LLMClient._API_CHAT_COMPLETIONS if chat_completion else LLMClient._ENDPOINT + LLMClient._API_COMPLETIONS
        _endpoint = _endpoint + "?api-version=" + api_version if api_version else _endpoint
        with requests.post(_endpoint, data=body, headers=headers) as response:
            #response.raise_for_status()
            print(response.json())
            return response.json()
 
    def send_stream_request(self, model_name, request):
        # get the token
        token = self._get_token()
 
        # populate the headers
        headers = {
            'Content-Type':'application/json',
            'Authorization': 'Bearer ' + token,
            'X-ModelType': model_name,
            "X-Taxonomy-Experience": "AppCopilots",
            "X-Taxonomy-Agent": "LLMAPISampleApp",
            "X-Taxonomy-InferenceStep": "InferenceTest",
            "X-Taxonomy-TrafficType": "Test",
        }
 
        body = str.encode(json.dumps(request))
        with requests.post(LLMClient._ENDPOINT + LLMClient._API_COMPLETIONS, data=body, headers=headers, stream=True) as response:
            response.raise_for_status()
 
            for line in response.iter_lines():
                text = line.decode('utf-8')
                if text.startswith('data: '):
                    text = text[6:]
                    if text == '[DONE]':
                        break
                    else:
                        yield json.loads(text)       
 
    def send_stream_chat_completion_request(self, model_name, request):
        # get the token
        token = self._get_token()
 
        # populate the headers
        headers = {
            'Content-Type':'application/json',
            'Authorization': 'Bearer ' + token,
            'X-ModelType': model_name,
            "X-Taxonomy-Experience": "AppCopilots",
            "X-Taxonomy-Agent": "LLMAPISampleApp",
            "X-Taxonomy-InferenceStep": "InferenceTest",
            "X-Taxonomy-TrafficType": "Test",
        }
        
        request["stream"] = True
        # TODO: Add when supported by Azure
        # request["stream_options"] = { "include_usage": True }
 
        body = str.encode(json.dumps(request))
        with requests.post(LLMClient._ENDPOINT + LLMClient._API_CHAT_COMPLETIONS, data=body, headers=headers, stream=True) as response:
            response.raise_for_status()
 
            final_content = ""
            final_func = []
            is_final = False
            token_count = 0
 
            # Handle streaming. Yield token response for content, but not for function calls.
            for line in response.iter_lines(decode_unicode=True):
                if line and line[6:] != "[DONE]":
                    try:
                        data = json.loads(line[6:])
                        if "content" in data['choices'][0]['delta']:
                            content = data['choices'][0]['delta']['content']
                            if content is None:
                                final_content = None
                            else:
                                final_content += content
                            token_count += 1
                            yield content            
                        if "tool_calls" in data['choices'][0]['delta']:
                            func = data['choices'][0]['delta']['tool_calls'][0]
                            if len(final_func) > func['index']:
                                final_func[-1]['function']['arguments'] += (func['function']['arguments'])
                            else:
                                final_func.append(func)
                            token_count += 1
                            yield ""
                        if not "content" in data['choices'][0]['delta'] and not "tool_calls" in data['choices'][0]['delta']:
                            if is_final:
                                raise Exception("Unknown response")
                            is_final = True
                    except Exception as ex:
                        print(ex)
 
            # Build final response to include all content and function calls
            del data['choices'][0]['delta']
            data['choices'][0]['message'] = { 'content': final_content }
            if final_func:
                data['choices'][0]['message']['tool_calls'] = final_func
 
            # Simulate the usage object. Hack until `include_usage` will be supported
            data['usage'] = { "prompt_tokens": -1, "completion_tokens": token_count, "total_tokens": 0 }
            yield data
 
    def _get_token(self):
        accounts = self._app.get_accounts()
        result = None
 
        if accounts:
            # Assuming the end user chose this one
            chosen = accounts[0]
 
            # Now let's try to find a token in cache for this account
            result = self._app.acquire_token_silent(LLMClient._SCOPES, account=chosen)
    
        if not result:
            result = self._app.acquire_token_interactive(scopes=LLMClient._SCOPES, parent_window_handle=self._app.CONSOLE_WINDOW_HANDLE)
            
            if 'error' in result:
                raise ValueError(
                    f"Failed to acquire token. Error: {json.dumps(result, indent=4)}"
                )
 
        return result["access_token"]
 
 
def sample_request(llm_client, model_name):
    request_data = {
            "prompt":"Seattle is",
            "max_tokens":50,
            "temperature":1,
            "top_p":1,
            "n":5,
            "stream":False,
            "logprobs":None,
            "stop":"\n"
    }
 
    response = llm_client.send_request(model_name, request_data)
    print("\n\n### sample_request ###")
    print(response)
 
def sample_streaming_request(llm_client, model_name):
    stream_request_data = {
            "prompt":"Instruction: Given an input question, respond with syntactically correct c++. Be creative but the c++ must be correct. \nInput: Create a function in c++ to remove duplicate strings in a std::vector<std::string>\n",
            "max_tokens":500,
            "temperature":0.6,
            "top_p":1,
            "n":1,
            "stream":True,
            "logprobs":None,
            "stop":"\r\n"
    }
 
    print("\n\n### sample_streaming_request ###")
    for response in llm_client.send_stream_request(model_name, stream_request_data):
        text = response.get('choices', [{}])[0].get('text')
        if text:
            print(text, end='')
 
def sample_non_streaming_chat_completion_request(llm_client, model_name):
    request_data = {
            "messages":[
                {
                    "role": "system",
                    "content": "You are an expert in Python. Provide detailed information to help the user.",
                },
                {
                    "role": "user",
                    "content": "How can I use the Chat Completion API?"
                }
            ],
            "max_tokens":500,
            "temperature":0.6,
            "top_p":1,
            "n":1,
            "logprobs":None,
            "stop":"\r\n"
    }    
 
    response = llm_client.send_request(model_name, request_data, chat_completion = True)
    print("\n\n### sample_non_streaming_chat_completion_request ###")
    print(response)
 
def sample_non_streaming_chat_completion_request_structured_output(llm_client, model_name, api_version = None):
    request_data = {
            "messages":[
                {
                    "role": "system",
                    "content": "Provide detailed information to help the user.",
                },
                {
                    "role": "user",
                    "content": "Give me a random number between 1 and 100, pick a randon langague and give this number name on that language."
                }
            ],
            "response_format":
            {
                "type": "json_schema",
                "json_schema":
                {
                    "name": "SampleStructureObject",
                    "strict": True,
                    "schema":{
                        "type":"object",
                        "properties":
                        {
                            "number":
                            {
                                "type":"number"
                            },
                            "language":
                            {
                                "type":"string"
                            },
                            "number_name":
                            {
                                "type":"string"
                            }
                        },
                    "required": ["number", "language", "number_name"],
                    "additionalProperties": False}
                }
            },        
            "max_tokens":500,
            "temperature":0.6,
            "top_p":1,
            "n":1,
            "logprobs":None,
            "stop":"\r\n"
    }    
 
    response = llm_client.send_request(model_name, request_data, chat_completion = True, api_version = api_version)
    print("\n\n### sample_non_streaming_chat_completion_request_structured_output ###")
    print("# Raw Response #")
    print(response)
    print("# Structured Json Content Response #")
    print(response['choices'][0]['message']['content'])
 
def sample_streaming_chat_completion_request(llm_client, model_name):
    stream_request_data = {
            "messages":[
                {
                    "role": "system",
                    "content":"You are an expert in Python. Provide detailed information to help the user.",
                },
                {
                    "role": "user",
                    "content":"How can I use the Chat Completion API?"
                }
            ],
            "max_tokens":500,
            "temperature":0.6,
            "top_p":1,
            "n":1,
            "stream":True,
            "logprobs":None,
            "stop":"\r\n"
    }
 
    print("\n\n### sample_streaming_chat_completion_request ###")
    for response_token in llm_client.send_stream_chat_completion_request(model_name, stream_request_data):
        if type(response_token) is str:
            print(response_token, end='')
 
def sample_streaming_function_chat_completion_request(llm_client, model_name):
    stream_request_data = {
            "messages":[
                {
                    "role": "assistant",
                    "content":"Send two emails to adimi@microsoft.com and to guojason@microsoft.com, thanking them for this code sample."
                }],
            "max_tokens":500,
            "temperature":0.6,
            "top_p":1,
            "n":1,
            "stream":True,
            "logprobs":None,
            "tools":[{
                        "type": "function",
                        "function": {
                            "name": "send_email",
                            "description": "send an email.",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "recipient": {
                                        "type": "string",
                                        "description": "the recipient email address",
                                    },
                                    "subject": {
                                        "type": "string",
                                        "description": "the subject of the Email"
                                    },
                                    "body": {
                                        "type": "string",
                                        "description": "the body of the Email"
                                    }
                                },
                                "required": ["recipient", "subject", "body"]
                            }
                        }
                    }],
            "tool_choice":"auto",
            "stop":"\r\n"
    }
 
    print("\n\n### sample_streaming_function_chat_completion_request ###")
    for response_token in llm_client.send_stream_chat_completion_request(model_name, stream_request_data):
        if type(response_token) is str:
            print(response_token, end='')
        elif response_token is not None:
            # Provides the full response object including `usage` and `tool_calls`
            response = response_token
 
    if "tool_calls" in response["choices"][0]["message"]:
        print("\n\nTool calls:")
        for tool_call in response["choices"][0]["message"]["tool_calls"]:
            print(tool_call["function"]["name"] + " " + str(tool_call["function"]["arguments"]))
 
 
parser = argparse.ArgumentParser(description='Async API Example')
parser.add_argument('--endpoint', type=str, help='Endpoint URL')
parser.add_argument('--scenario', type=str, help='Scenario ID')
 
args = parser.parse_args()
 
endpoint = args.endpoint
scenario_id = args.scenario
llm_client = LLMClient(endpoint)
 
# Available models are listed here: https://eng.ms/docs/experiences-devices/m365-core/microsoft-search-assistants-intelligence-msai/substrate-intelligence/llm-api/llm-api-partner-docs/available-models/available-models
 
# Completion API is deprecated for GPT models
# sample_request(llm_client, model_name = 'dev-gpt-4o-2024-05-13')
# sample_streaming_request(llm_client, model_name = 'dev-gpt-4o-2024-05-13')
 
# Chat Completion API samples
sample_non_streaming_chat_completion_request(llm_client, model_name = 'dev-gpt-4o-gg')
# sample_streaming_chat_completion_request(llm_client, model_name = 'dev-gpt-4o-2024-05-13-chat-completions')
# sample_streaming_function_chat_completion_request(llm_client, model_name = 'dev-gpt-4o-2024-05-13-chat-completions')        
 
# # Chat Completion API with Structured Outputs
# sample_non_streaming_chat_completion_request_structured_output(llm_client, model_name = 'dev-gpt-4o-2024-08-06-chat-completions', api_version = '2024-08-01-preview')