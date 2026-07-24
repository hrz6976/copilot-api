import json
import sys
import requests
import argparse
from msal import PublicClientApplication
 
class LLMClient:
 
    _ENDPOINT = 'https://fe-26.qas.bing.net/sdf/' # SDF
    _SCOPES = ['https://substrate.office.com/llmapi/LLMAPI.dev']
    _API_MESSAGES = 'messages'
    _TIMEOUT = (10, 300)   # (connect, read) in seconds
 
    def __init__(self, endpoint=None):
        if endpoint:
            LLMClient._ENDPOINT = endpoint
 
        self._app = PublicClientApplication(
            '68df66a4-cad9-4bfd-872b-c6ddde00d6b2',
            authority='https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47',
            enable_broker_on_windows=True
        )
 
    def send_request(self, model_name, request):
        token = self._get_token()
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
            'X-ModelType': model_name,
            'anthropic-version': "2023-06-01",
            "X-Taxonomy-Experience": "AppCopilots",
            "X-Taxonomy-Agent": "LLMAPISampleApp",
            "X-Taxonomy-InferenceStep": "InferenceTest",
            "X-Taxonomy-TrafficType": "Test",
        }
 
        body = json.dumps(request).encode()
        endpoint = f"{LLMClient._ENDPOINT}{LLMClient._API_MESSAGES}"
        response = requests.post(endpoint, data=body, headers=headers, timeout=LLMClient._TIMEOUT)
        response.raise_for_status()
        return response.json()
 
    def send_stream_request_anthropic(self, model_name, request):
        token = self._get_token()
 
        headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            'X-ModelType': model_name,
            'anthropic-version': '2023-06-01',
            "X-Taxonomy-Experience": "AppCopilots",
            "X-Taxonomy-Agent": "LLMAPISampleApp",
            "X-Taxonomy-InferenceStep": "InferenceTest",
            "X-Taxonomy-TrafficType": "Test",
        }
 
        body = json.dumps(request).encode()
        endpoint = f"{LLMClient._ENDPOINT}{LLMClient._API_MESSAGES}"
 
        with requests.post(endpoint, data=body, headers=headers, stream=True, timeout=LLMClient._TIMEOUT) as response:
            response.raise_for_status()
 
            for line in response.iter_lines():
                text = line.decode('utf-8').strip()
                if not text:
                    continue
                if text.startswith('data: '):
                    text = text[6:]
                    if not text or text == '[DONE]':
                        break
                    try:
                        yield json.loads(text)
                    except json.JSONDecodeError as e:
                        print(f"\n[ERROR] Unparseable SSE frame: {text!r} ({e})")
                        break
 
    def _get_token(self):
        accounts = self._app.get_accounts()
        result = None
 
        if accounts:
            result = self._app.acquire_token_silent(LLMClient._SCOPES, account=accounts[0])
 
        if not result:
            if sys.platform == 'win32':
                result = self._app.acquire_token_interactive(scopes=LLMClient._SCOPES, parent_window_handle=self._app.CONSOLE_WINDOW_HANDLE)
            else:
                # macOS/Linux: app registration lacks http://localhost redirect URI,
                # so use device code flow instead of interactive.
                flow = self._app.initiate_device_flow(scopes=LLMClient._SCOPES)
                if 'user_code' not in flow:
                    raise ValueError(f"Failed to initiate device flow: {json.dumps(flow, indent=4)}")
                print(flow['message'])
                result = self._app.acquire_token_by_device_flow(flow)
 
            if 'error' in result:
                raise ValueError(f"Failed to acquire token. Error: {json.dumps(result, indent=4)}")
 
        return result["access_token"]
 
def sample_messages_request(llm_client, model_name):
    request_data = {
        "max_tokens": 1024,
        "messages": [
            {"role": "user", "content": "Hello, world"}
        ]
    }
 
    response = llm_client.send_request(model_name, request_data)
    print("\n\n### sample_messages_request ###")
    print(response)
 
def sample_thinking_messages_request(llm_client, model_name):
    request_data = {
            "max_tokens": 32000,
            "messages": [
                    {"role": "user", "content": "Hello, how are you?"}
            ],
            "thinking": {
                    "type": "enabled",
                    "budget_tokens": 16000
            }
 
    }
 
    response = llm_client.send_request(model_name, request_data)
    print("\n\n### sample_thinking_messages_request ###")
    print(response)
 
def sample_streaming_request_anthropic(llm_client, model_name):
    stream_request_data = {
        "system": "You are a helpful assistant that writes correct C++ code.",
        "messages": [
            {
                "role": "user",
                "content": (
                    "Instruction: Given an input question, respond with syntactically correct C++. "
                    "Be creative but the C++ must be correct.\n\n"
                    "Input: Create a function in C++ to remove duplicate strings in a std::vector<std::string>\n"
                )
            }
        ],
        "max_tokens": 500,
        "temperature": 0.6,
        "stream": True
    }
 
    print("\n\n### sample_streaming_request_anthropic ###")
    for response in llm_client.send_stream_request_anthropic(model_name, stream_request_data):
        print(response)
 
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Anthropic Messages API Example')
    parser.add_argument('--endpoint', type=str, help='Endpoint URL')
    args = parser.parse_args()
 
    llm_client = LLMClient(endpoint=args.endpoint)
    sample_streaming_request_anthropic(llm_client, model_name='dev-anthropic-claude-opus-4-1')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-opus-4-1')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-opus-4-5')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-opus-4-6')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-opus-4-0')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-sonnet-4-0')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-sonnet-4-5')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-sonnet-4-6')
    sample_messages_request(llm_client, model_name='dev-anthropic-claude-haiku-4-5')
    sample_thinking_messages_request(llm_client, model_name='dev-anthropic-claude-sonnet-4-5')
 