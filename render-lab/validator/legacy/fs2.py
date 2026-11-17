import sys, importlib.util
spec = importlib.util.spec_from_file_location("fs2", r"C:\Users\syedm\Downloads\tools\TILT\forge\forge_server.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.ARTIFACTS = r"C:\Users\syedm\AppData\Local\Temp\opencode\fa"
import http.server
http.server.ThreadingHTTPServer(("127.0.0.1", 8771), m.Handler).serve_forever()
