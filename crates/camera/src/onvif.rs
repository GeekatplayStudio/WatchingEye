//! ONVIF: the vendor-neutral way into an NVR or camera.
//!
//! Worth having even where a vendor API exists. Reolink hardware from before
//! the JSON CGI firmware — and plenty of NVRs from other makers — expose
//! ONVIF and nothing else, so this is the difference between "supported" and
//! "you cannot use your recorder".
//!
//! Two details this module exists to get right:
//!
//! - **`GetSystemDateAndTime` needs no authentication.** The ONVIF spec
//!   requires it to be answerable unauthenticated, which makes it the one
//!   reliable way to confirm a device speaks ONVIF before any credential is
//!   involved.
//! - **WS-Security digests are time-sensitive.** The digest is over a nonce
//!   and a timestamp; a device whose clock has drifted rejects correct
//!   credentials. So [`security_header`] takes the timestamp as a parameter
//!   rather than reading the clock, both to stay testable and to let callers
//!   compensate using the unauthenticated time reply.
//!
//! Pure, like the rest of this crate: bodies in, parsed values out.

use serde::{Deserialize, Serialize};

/// Paths and ports ONVIF devices are commonly found on, most likely first.
///
/// Port 8000 is here because that is where real hardware answered — the
/// spec's suggested port 80 is not what consumer NVRs actually use.
pub const ONVIF_ENDPOINTS: &[(u16, &str)] = &[
    (8000, "/onvif/device_service"),
    (80, "/onvif/device_service"),
    (8899, "/onvif/device_service"),
    (2020, "/onvif/device_service"),
    (80, "/onvif/services"),
];

/// SOAP envelope for the unauthenticated liveness/identification call.
///
/// @example
/// ```
/// assert!(camera::onvif::get_system_date_body().contains("GetSystemDateAndTime"));
/// ```
#[must_use]
pub fn get_system_date_body() -> String {
    envelope(
        None,
        r#"<tds:GetSystemDateAndTime xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>"#,
    )
}

/// SOAP envelope for `GetDeviceInformation`, which requires credentials.
#[must_use]
pub fn get_device_information_body(auth: Option<&str>) -> String {
    envelope(
        auth,
        r#"<tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>"#,
    )
}

/// SOAP envelope for `GetProfiles` — one profile per stream a device offers.
#[must_use]
pub fn get_profiles_body(auth: Option<&str>) -> String {
    envelope(
        auth,
        r#"<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl"/>"#,
    )
}

/// SOAP envelope for `GetStreamUri` for one profile token.
#[must_use]
pub fn get_stream_uri_body(auth: Option<&str>, profile_token: &str) -> String {
    let token = xml_escape(profile_token);
    envelope(
        auth,
        &format!(
            r#"<trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
<trt:StreamSetup xmlns:tt="http://www.onvif.org/ver10/schema">
<tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
</trt:StreamSetup><trt:ProfileToken>{token}</trt:ProfileToken></trt:GetStreamUri>"#
        ),
    )
}

/// Wrap a body, with an optional WS-Security header.
fn envelope(auth: Option<&str>, body: &str) -> String {
    let header = auth.map_or_else(String::new, |h| format!("<s:Header>{h}</s:Header>"));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">{header}<s:Body>{body}</s:Body></s:Envelope>"#
    )
}

/// Build a WS-Security `UsernameToken` header with a password digest.
///
/// `digest` must be `base64(sha1(nonce_bytes ++ created ++ password))` and
/// `nonce_b64` the same nonce, base64-encoded. Both are supplied rather than
/// computed here so this crate needs no hashing dependency and the header
/// layout stays independently testable.
#[must_use]
pub fn security_header(username: &str, digest: &str, nonce_b64: &str, created: &str) -> String {
    format!(
        r#"<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>{}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{}</wsse:Nonce><wsu:Created>{}</wsu:Created></wsse:UsernameToken></wsse:Security>"#,
        xml_escape(username),
        xml_escape(digest),
        xml_escape(nonce_b64),
        xml_escape(created)
    )
}

/// What a device says about itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnvifDevice {
    /// Vendor, e.g. `"Reolink"`.
    pub manufacturer: String,
    /// Model string.
    pub model: String,
    /// Firmware version.
    pub firmware: String,
    /// Serial number.
    pub serial: String,
}

/// One media profile — in practice one camera's main or sub stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnvifProfile {
    /// Token to pass to `GetStreamUri`.
    pub token: String,
    /// Human-readable profile name, often the channel name.
    pub name: String,
}

/// Read the text of the first `<...:Tag>` in a document, namespace-agnostic.
///
/// A hand-rolled reader rather than an XML parser: the shapes involved are
/// small and fixed, and this keeps the crate free of a parser dependency.
/// It reads elements, so it is unaffected by which prefix a vendor picked.
#[must_use]
pub fn tag_text(xml: &str, local_name: &str) -> Option<String> {
    let (start, open_end) = find_open_tag(xml, local_name, 0)?;
    let _ = start;
    let rest = &xml[open_end..];
    let close = rest.find("</")?;
    Some(unescape(rest[..close].trim()))
}

/// Locate `<prefix:local_name ...>` from `from`, returning its span.
fn find_open_tag(xml: &str, local_name: &str, from: usize) -> Option<(usize, usize)> {
    let mut cursor = from;
    while let Some(rel) = xml[cursor..].find('<') {
        let open = cursor + rel;
        let after = open + 1;
        let end = xml[after..].find('>')? + after;
        let inner = &xml[after..end];
        let name = inner.split_whitespace().next().unwrap_or(inner);
        let local = name.rsplit(':').next().unwrap_or(name);
        if local == local_name && !inner.starts_with('/') {
            return Some((open, end + 1));
        }
        cursor = end + 1;
    }
    None
}

/// Read a `GetDeviceInformationResponse`.
///
/// @example
/// ```
/// let xml = "<tds:Manufacturer>Reolink</tds:Manufacturer>";
/// assert_eq!(camera::onvif::parse_device_info(xml).manufacturer, "Reolink");
/// ```
#[must_use]
pub fn parse_device_info(xml: &str) -> OnvifDevice {
    OnvifDevice {
        manufacturer: tag_text(xml, "Manufacturer").unwrap_or_default(),
        model: tag_text(xml, "Model").unwrap_or_default(),
        firmware: tag_text(xml, "FirmwareVersion").unwrap_or_default(),
        serial: tag_text(xml, "SerialNumber").unwrap_or_default(),
    }
}

/// Read the profiles from a `GetProfilesResponse`.
///
/// Each profile carries its token as an attribute, not an element, so the
/// attribute is read directly.
#[must_use]
pub fn parse_profiles(xml: &str) -> Vec<OnvifProfile> {
    let mut profiles = Vec::new();
    let mut cursor = 0;
    while let Some((open, open_end)) = find_open_tag(xml, "Profiles", cursor) {
        let tag = &xml[open..open_end];
        let token = attribute(tag, "token").unwrap_or_default();
        // The name is the first <Name> inside this profile element.
        let body = &xml[open_end..];
        let name = tag_text(body, "Name").unwrap_or_default();
        if !token.is_empty() {
            profiles.push(OnvifProfile { token, name });
        }
        cursor = open_end;
    }
    profiles
}

/// Read the RTSP URL from a `GetStreamUriResponse`.
#[must_use]
pub fn parse_stream_uri(xml: &str) -> Option<String> {
    tag_text(xml, "Uri").filter(|u| !u.is_empty())
}

/// Whether a reply is a SOAP fault, and what it said.
///
/// A fault is an ordinary HTTP 200 in SOAP, so it must be checked explicitly
/// or a failure reads as an empty success.
#[must_use]
pub fn soap_fault(xml: &str) -> Option<String> {
    if !xml.contains("Fault") {
        return None;
    }
    tag_text(xml, "Text")
        .or_else(|| tag_text(xml, "faultstring"))
        .or_else(|| Some("SOAP fault".to_owned()))
}

/// Read an attribute value out of an opening tag.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(unescape(&rest[..end]))
}

/// Escape the five XML metacharacters.
fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Reverse [`xml_escape`] for the entities devices actually emit.
fn unescape(raw: &str) -> String {
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// Shape of a real NVR reply, with addresses genericised.
    const DATE_REPLY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
 xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
<SOAP-ENV:Body><tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime>
<tt:DateTimeType>Manual</tt:DateTimeType><tt:UTCDateTime><tt:Time>
<tt:Hour>18</tt:Hour><tt:Minute>19</tt:Minute></tt:Time><tt:Date>
<tt:Year>2026</tt:Year><tt:Month>7</tt:Month><tt:Day>31</tt:Day>
</tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>
</SOAP-ENV:Body></SOAP-ENV:Envelope>"#;

    #[test]
    fn reads_values_regardless_of_namespace_prefix() {
        assert_eq!(tag_text(DATE_REPLY, "Hour").unwrap(), "18");
        assert_eq!(tag_text(DATE_REPLY, "Year").unwrap(), "2026");
        assert_eq!(tag_text(DATE_REPLY, "DateTimeType").unwrap(), "Manual");
    }

    #[test]
    fn a_real_onvif_reply_is_recognised_as_such() {
        assert!(DATE_REPLY.contains("GetSystemDateAndTimeResponse"));
        assert!(soap_fault(DATE_REPLY).is_none());
    }

    #[test]
    fn missing_tags_read_as_absent_not_as_empty_success() {
        assert!(tag_text(DATE_REPLY, "Manufacturer").is_none());
    }

    #[test]
    fn reads_device_information() {
        let xml = r"<tds:GetDeviceInformationResponse>
            <tds:Manufacturer>Reolink</tds:Manufacturer><tds:Model>RLN8-410</tds:Model>
            <tds:FirmwareVersion>v2.0.0</tds:FirmwareVersion>
            <tds:SerialNumber>ABC123</tds:SerialNumber></tds:GetDeviceInformationResponse>";
        let d = parse_device_info(xml);
        assert_eq!(d.manufacturer, "Reolink");
        assert_eq!(d.model, "RLN8-410");
        assert_eq!(d.serial, "ABC123");
    }

    #[test]
    fn reads_every_profile_with_its_token() {
        let xml = r#"<trt:GetProfilesResponse>
            <trt:Profiles token="Profile_1" fixed="true"><tt:Name>MainStream</tt:Name></trt:Profiles>
            <trt:Profiles token="Profile_2"><tt:Name>SubStream</tt:Name></trt:Profiles>
            </trt:GetProfilesResponse>"#;
        let p = parse_profiles(xml);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].token, "Profile_1");
        assert_eq!(p[0].name, "MainStream");
        assert_eq!(p[1].token, "Profile_2");
    }

    #[test]
    fn reads_the_rtsp_url() {
        let xml = r"<trt:GetStreamUriResponse><trt:MediaUri>
            <tt:Uri>rtsp://192.168.1.50:554/h264Preview_01_main</tt:Uri>
            </trt:MediaUri></trt:GetStreamUriResponse>";
        assert_eq!(
            parse_stream_uri(xml).unwrap(),
            "rtsp://192.168.1.50:554/h264Preview_01_main"
        );
    }

    #[test]
    fn a_soap_fault_is_detected_despite_the_200_status() {
        let xml = r"<s:Envelope><s:Body><s:Fault><s:Reason>
            <s:Text>Sender not Authorized</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>";
        assert_eq!(soap_fault(xml).unwrap(), "Sender not Authorized");
    }

    #[test]
    fn the_liveness_probe_carries_no_credentials() {
        // It must stay unauthenticated: that is the whole point of using it
        // to confirm ONVIF before asking anyone for a password.
        let body = get_system_date_body();
        assert!(!body.contains("Security"));
        assert!(!body.contains("Username"));
    }

    #[test]
    fn authenticated_bodies_carry_the_security_header() {
        let header = security_header("admin", "digest==", "nonce==", "2026-07-31T18:19:18Z");
        let body = get_profiles_body(Some(&header));
        assert!(body.contains("<s:Header>"));
        assert!(body.contains("wsse:UsernameToken"));
        assert!(body.contains("PasswordDigest"));
        assert!(body.contains("2026-07-31T18:19:18Z"));
    }

    #[test]
    fn credentials_with_xml_metacharacters_cannot_break_the_envelope() {
        let header = security_header("ad<min&", "d\"", "n", "t");
        assert!(header.contains("ad&lt;min&amp;"));
        assert!(!header.contains("ad<min&"));
    }

    #[test]
    fn a_profile_token_with_metacharacters_is_escaped() {
        let body = get_stream_uri_body(None, "tok<en");
        assert!(body.contains("tok&lt;en"));
    }

    #[test]
    fn entities_are_decoded_when_reading() {
        assert_eq!(
            tag_text("<a:Name>Front &amp; Rear</a:Name>", "Name").unwrap(),
            "Front & Rear"
        );
    }

    #[test]
    fn survives_junk_input() {
        assert!(tag_text("", "Name").is_none());
        assert!(tag_text("<<<>>>", "Name").is_none());
        assert!(parse_profiles("not xml").is_empty());
        assert_eq!(parse_device_info(""), OnvifDevice::default());
    }
}
