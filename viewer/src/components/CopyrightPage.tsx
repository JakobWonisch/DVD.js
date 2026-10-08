import { Show, type Component } from 'solid-js';
import { COPYRIGHT_CONTACT as C } from '../copyrightContact.js';

const emailLooksReal = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.startsWith('REPLACE_');

/**
 * First-pass copyright / DMCA availability page.
 * Aligned with common §512 notice elements; not a substitute for counsel.
 */
export const CopyrightPage: Component = () => (
  <article class="legal-page">
    <h1>Copyright and take-down requests</h1>
    <p class="legal-page__lede">
      DVD Menu Archive preserves DVD <em>menus</em> for interoperability and
      historical study. We respect copyright. If you own (or are authorized to
      act for the owner of) material available here and you believe it should
      not be hosted, send a take-down notice. We will review complete notices
      promptly and remove or disable access to the identified material when
      appropriate.
    </p>

    <section>
      <h2>How to request removal</h2>
      <p>
        Email a written notice to the contact below. To help us act quickly,
        please include substantially the same information U.S. law expects in a
        DMCA notification of claimed infringement (
        <a href="https://www.copyright.gov/512/">17 U.S.C. §&nbsp;512</a>
        ):
      </p>
      <ol>
        <li>
          A physical or electronic signature of the copyright owner, or a
          person authorized to act on their behalf.
        </li>
        <li>
          Identification of the copyrighted work claimed to have been
          infringed. If several works on one site are covered, a representative
          list is enough.
        </li>
        <li>
          Identification of the material claimed to be infringing, and
          information reasonably sufficient for us to locate it (for example
          the disc name and the full URL of the catalogue entry or player page,
          such as <code>/play/…</code>).
        </li>
        <li>
          Your name, mailing address, telephone number, and email address.
        </li>
        <li>
          A statement that you have a good-faith belief that use of the
          material in the manner complained of is not authorized by the
          copyright owner, its agent, or the law (for example, fair use).
        </li>
        <li>
          A statement that the information in the notice is accurate, and under
          penalty of perjury, that you are the owner, or are authorized to act
          on behalf of the owner, of an exclusive right that is allegedly
          infringed.
        </li>
      </ol>
      <p>
        Incomplete notices may be returned with a request for the missing
        details. Knowingly material misrepresentations in a notice can create
        liability under the DMCA; if you are unsure of your rights, consult a
        lawyer before sending a notice.
      </p>
    </section>

    <section>
      <h2>What we do after a notice</h2>
      <ol>
        <li>Confirm the notice is substantially complete.</li>
        <li>
          Where the claim is clear, remove or disable public access to the
          identified disc package (or the specific material, if narrower
          relief is practical) as soon as reasonably possible.
        </li>
        <li>
          Keep a record of the notice and our response for our own compliance
          files.
        </li>
      </ol>
      <p>
        This archive is operated as a preservation project, not as a general
        user-upload host. If you submitted material that was later removed and
        you believe the removal was a mistake or misidentification, you may
        send a counter-notice that includes: your signature; identification of
        the material and where it appeared; a statement under penalty of
        perjury that you have a good-faith belief the material was removed by
        mistake or misidentification; your name, address, and phone number;
        consent to the jurisdiction of the appropriate U.S. federal district
        court (or, if outside the United States, any district where the
        service provider may be found); and acceptance of service of process
        from the original complainant. We will follow the statutory
        counter-notice timeline when it applies.
      </p>
    </section>

    <section>
      <h2>Repeat infringement</h2>
      <p>
        In appropriate circumstances we will stop hosting material from sources
        that repeatedly infringe copyright, and we reserve the right to refuse
        or remove content accordingly.
      </p>
    </section>

    <section id="contact">
      <h2>Designated contact</h2>
      <p>
        Send copyright notices to the following contact. Prefer email for the
        fastest response.
      </p>
      <dl class="legal-page__contact">
        <dt>Service</dt>
        <dd>{C.serviceName}</dd>
        <dt>Service provider (legal name)</dt>
        <dd>{C.serviceProviderLegalName}</dd>
        <dt>Service provider address</dt>
        <dd>{C.serviceProviderStreetAddress}</dd>
        <dt>Agent</dt>
        <dd>
          {C.agentName}
          {C.agentOrganization ? ` (${C.agentOrganization})` : null}
        </dd>
        <dt>Agent mail</dt>
        <dd>{C.agentMailAddress}</dd>
        <dt>Phone</dt>
        <dd>{C.agentPhone}</dd>
        <dt>Email</dt>
        <dd>
          <Show
            when={emailLooksReal(C.agentEmail)}
            fallback={<code>{C.agentEmail}</code>}
          >
            <a href={`mailto:${C.agentEmail}`}>{C.agentEmail}</a>
          </Show>
        </dd>
      </dl>
      <p class="muted legal-page__note">
        For operators seeking U.S. DMCA safe-harbor designation: the same agent
        information must also be filed in the{' '}
        <a href="https://www.copyright.gov/dmca-directory/">
          Copyright Office DMCA Designated Agent Directory
        </a>{' '}
        and kept current (renewal every three years). Posting this page alone
        is not a Copyright Office registration.
      </p>
    </section>

    <section>
      <h2>About this project</h2>
      <p>
        Converted packages are menu-focused (still and motion menus, navigation,
        short interactive cells). Feature titles are often omitted. Nothing here
        is an invitation to infringe copyright, and availability of a disc in
        the catalogue does not mean we claim ownership of the underlying works.
      </p>
    </section>

    <p class="muted legal-page__note">
      This page describes our take-down process for rightsholders. It is not
      legal advice. Requirements and safe-harbor eligibility depend on your
      jurisdiction and facts; consult counsel for advice about your situation.
    </p>
  </article>
);
