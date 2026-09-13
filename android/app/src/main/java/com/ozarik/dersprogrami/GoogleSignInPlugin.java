package com.ozarik.dersprogrami;

import android.os.CancellationSignal;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Google ile giris (Android Credential Manager).
 *
 * Google, uygulama icindeki WebView'den girise izin vermedigi icin web'deki
 * Google Identity Services burada calismaz. Bu eklenti telefonun yerel hesap
 * seciciyi acar ve sunucunun dogruladigi Google ID tokenini dondurur. Tokenin
 * hedef kitlesi (aud) web istemci kimligidir; sunucu ayni kimligi bekler.
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    private final Executor executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void signIn(PluginCall call) {
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.trim().isEmpty()) {
            call.reject("webClientId gerekli", "invalid-argument");
            return;
        }

        GetSignInWithGoogleOption.Builder option = new GetSignInWithGoogleOption.Builder(webClientId.trim());
        String nonce = call.getString("nonce");
        if (nonce != null && !nonce.isEmpty()) {
            option.setNonce(nonce);
        }

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option.build())
            .build();

        CredentialManager manager = CredentialManager.create(getContext());
        manager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof CustomCredential)
                        || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        call.reject("Beklenmeyen kimlik bilgisi türü", "invalid-response");
                        return;
                    }
                    try {
                        GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                        JSObject result = new JSObject();
                        result.put("idToken", google.getIdToken());
                        result.put("email", google.getId());
                        result.put("name", google.getDisplayName());
                        call.resolve(result);
                    } catch (Exception exception) {
                        call.reject("Google yanıtı okunamadı", "invalid-response", exception);
                    }
                }

                @Override
                public void onError(GetCredentialException exception) {
                    String code;
                    if (exception instanceof GetCredentialCancellationException) {
                        code = "canceled";
                    } else if (exception instanceof NoCredentialException) {
                        code = "no-credential";
                    } else {
                        code = "failed";
                    }
                    String message = exception.getMessage() != null ? exception.getMessage() : "Google girişi başarısız";
                    call.reject(message, code, exception);
                }
            }
        );
    }

    /** Cikista kayitli Google oturum durumunu temizler; bir sonraki giriste hesap yeniden sorulur. */
    @PluginMethod
    public void signOut(PluginCall call) {
        CredentialManager.create(getContext()).clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            executor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    call.resolve();
                }

                @Override
                public void onError(ClearCredentialException exception) {
                    // Temizlenecek durum yoksa da cikis basarili sayilir.
                    call.resolve();
                }
            }
        );
    }
}
